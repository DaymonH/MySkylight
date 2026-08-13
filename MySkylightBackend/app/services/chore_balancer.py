"""Chore-load balancer — the pure optimization core (no DB, no I/O).

Given a set of recurring chores whose *frequency* is already fixed by the user,
this picks the two free levers the data model leaves open per chore — **which
day** it lands on and **who does it first** (the rotation phase) — to spread the
household's effort across the week and keep it even between the people sharing it.

It works on plain numbers so it's trivially testable; ``app.services.tasks``
adapts the ORM tasks into ``OptItem``s (expanding each candidate placement's
occurrences with the real recurrence engine) and maps the result back to task
field updates. See ``compute_balance_plan`` there.

Model: each item offers candidate *placements* (e.g. one per allowed weekday for
a weekly chore; a single keep-as-is candidate for a daily/locked one). A
placement is the ordered list of *date ordinals* of that chore's occurrences over
the planning horizon. The optimizer chooses, per item, a placement and — for a
rotating item — a *starter* (which person takes the first occurrence; the rest
cycle the roster in order). Fixed items always fall to one named person.

Cost is scored on **actual dates and weeks** (not horizon-averaged), because a
weekly-rotating chore alternates each week — averaging would hide the very thing
we're fixing ("one of us has a ton this week, the other none"). The terms:
matching each person's target share, evening each calendar week between people,
evening each day, spreading load off clumped days, and shaving the worst single
day. A greedy seed plus hill-climbing with random restarts converges in well
under a second for any realistic family.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

# Relative importance of the cost terms. Fairness (matching each person's target
# share over the horizon) leads. Weekly balance keeps any one calendar week from
# burying a person (the rotation-staggering lever). Clump — the household's load
# per day, squared — is what spreads chores *across* days. Person-day — each
# person's load per day, squared — keeps one person from stacking up on a single
# day (and splits same-day chores between people). Peak is a light tie-breaker.
#
# Note we deliberately do NOT reward per-day balance *between* people: with few
# chores that pushes two chores onto one shared day instead of spreading them out,
# which is the opposite of what families want.
W_FAIRNESS = 3.0
W_WEEKLY = 2.0
W_CLUMP = 1.0
W_PERSONDAY = 0.6
W_PEAK = 0.3

_RESTARTS = 6


@dataclass
class OptItem:
    """One chore the optimizer can place/assign.

    ``candidates[c]`` is the ordered list of date ordinals (``date.toordinal()``)
    of that chore's occurrences over the horizon under candidate placement ``c``.
    """

    candidates: list[list[int]]
    effort: float
    mode: str  # "rotate" | "fixed"
    fixed_p: int | None = None  # person index for a fixed chore (None = outside the group)


class Loads:
    """Effort tallied per person overall, per calendar week, and per calendar day."""

    def __init__(self, num_people: int):
        self.num_people = num_people
        self.per_person = [0.0] * num_people
        self.per_week: dict[int, list[float]] = {}
        self.per_date: dict[int, list[float]] = {}

    def add(self, person: int, ordinal: int, effort: float) -> None:
        self.per_person[person] += effort
        # Monday-aligned week index (matches the engine's _week_ordinal).
        wk = (ordinal - 1) // 7
        self.per_week.setdefault(wk, [0.0] * self.num_people)[person] += effort
        self.per_date.setdefault(ordinal, [0.0] * self.num_people)[person] += effort

    def copy(self) -> "Loads":
        clone = Loads(self.num_people)
        clone.per_person = list(self.per_person)
        clone.per_week = {k: list(v) for k, v in self.per_week.items()}
        clone.per_date = {k: list(v) for k, v in self.per_date.items()}
        return clone


def _starters(item: OptItem, num_people: int) -> list[int]:
    if item.mode == "rotate":
        return list(range(num_people))
    return [0]  # fixed: starter is unused


def _assignee(item: OptItem, occ_index: int, starter: int, num_people: int) -> int | None:
    if item.mode == "fixed":
        return item.fixed_p
    return (starter + occ_index) % num_people


def _accumulate(
    items: list[OptItem],
    choices: list[tuple[int, int]],
    num_people: int,
    background: Loads,
) -> Loads:
    loads = background.copy()
    for item, (cand_idx, starter) in zip(items, choices):
        for i, ordinal in enumerate(item.candidates[cand_idx]):
            p = _assignee(item, i, starter, num_people)
            if p is None:
                continue  # fixed to someone outside the balancing group — ignore
            loads.add(p, ordinal, item.effort)
    return loads


def _variance(values: list[float]) -> float:
    n = len(values)
    if n <= 1:
        return 0.0
    mean = sum(values) / n
    return sum((v - mean) ** 2 for v in values)


def _cost(loads: Loads, num_people: int, targets_week: list[float], weeks: float) -> float:
    fairness = 0.0
    for p in range(num_people):
        diff = loads.per_person[p] / weeks - targets_week[p]
        fairness += diff * diff

    weekly = sum(_variance(v) for v in loads.per_week.values())
    clump = sum(sum(v) ** 2 for v in loads.per_date.values())
    person_day = sum(x * x for v in loads.per_date.values() for x in v)
    peak = max((max(v) for v in loads.per_date.values()), default=0.0)

    return (
        W_FAIRNESS * fairness
        + W_WEEKLY * weekly
        + W_CLUMP * clump
        + W_PERSONDAY * person_day
        + W_PEAK * peak
    )


def _greedy_init(
    items: list[OptItem],
    num_people: int,
    targets_week: list[float],
    weeks: float,
    background: Loads,
    rng: random.Random,
) -> list[tuple[int, int]]:
    """Seed by placing the busiest chores first, each where it least worsens the cost."""
    order = sorted(range(len(items)), key=lambda i: -sum(len(c) for c in items[i].candidates))
    choices: list[tuple[int, int]] = [(0, 0)] * len(items)
    placed: list[int] = []
    for idx in order:
        best_choice = (0, 0)
        best_cost = float("inf")
        options = [
            (ci, s)
            for ci in range(len(items[idx].candidates))
            for s in _starters(items[idx], num_people)
        ]
        rng.shuffle(options)
        for ci, s in options:
            choices[idx] = (ci, s)
            subset = placed + [idx]
            loads = _accumulate(
                [items[i] for i in subset], [choices[i] for i in subset], num_people, background
            )
            c = _cost(loads, num_people, targets_week, weeks)
            if c < best_cost:
                best_cost = c
                best_choice = (ci, s)
        choices[idx] = best_choice
        placed.append(idx)
    return choices


def optimize(
    items: list[OptItem],
    num_people: int,
    shares: list[float],
    background: Loads,
    weeks: float,
    seed: int = 0,
) -> list[tuple[int, int]]:
    """Return the chosen ``(candidate_index, starter)`` per item minimizing the cost.

    ``shares`` are each person's target fraction of the load (sum to 1).
    ``background`` is the fixed load from kept/unmanaged chores. ``weeks`` is the
    horizon length in weeks (for per-week normalization). ``seed`` makes runs
    reproducible and lets the UI "regenerate" a different balanced layout.
    """
    if not items:
        return []

    # Target per-person weekly load = their share of the grand total. The plan's
    # total is fixed (every occurrence gets done by someone), estimated from the
    # first candidate of each item; the background is the kept-chore load.
    plan_week = sum(item.effort * len(item.candidates[0]) for item in items) / weeks
    grand_week = sum(background.per_person) / weeks + plan_week
    targets_week = [share * grand_week for share in shares]

    best_choices: list[tuple[int, int]] | None = None
    best_cost = float("inf")

    for restart in range(_RESTARTS):
        rng = random.Random(seed * 1000 + restart)
        if restart == 0:
            choices = _greedy_init(items, num_people, targets_week, weeks, background, rng)
        else:
            choices = [
                (rng.randrange(len(item.candidates)), rng.choice(_starters(item, num_people)))
                for item in items
            ]

        improved = True
        while improved:
            improved = False
            order = list(range(len(items)))
            rng.shuffle(order)
            for idx in order:
                current = choices[idx]
                local_best = current
                local_cost = _cost(
                    _accumulate(items, choices, num_people, background),
                    num_people,
                    targets_week,
                    weeks,
                )
                for ci in range(len(items[idx].candidates)):
                    for s in _starters(items[idx], num_people):
                        choices[idx] = (ci, s)
                        c = _cost(
                            _accumulate(items, choices, num_people, background),
                            num_people,
                            targets_week,
                            weeks,
                        )
                        if c < local_cost - 1e-9:
                            local_cost = c
                            local_best = (ci, s)
                choices[idx] = local_best
                if local_best != current:
                    improved = True

        loads = _accumulate(items, choices, num_people, background)
        c = _cost(loads, num_people, targets_week, weeks)
        if c < best_cost:
            best_cost = c
            best_choices = list(choices)

    assert best_choices is not None
    return best_choices
