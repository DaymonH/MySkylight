"use client"

import { use, useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderPlusIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useCreateRoutine,
  useCreateTask,
  useDeleteRoutine,
  useDeleteTask,
  useRoutines,
  useStreak,
  useTasks,
  useUpdateRoutine,
  useUpdateTask,
} from "@/hooks/use-tasks"
import { NO_ROUTINE, TaskSheet, type TaskFormValues } from "@/components/tasks/task-sheet"
import { BalanceSheet } from "@/components/tasks/balance-sheet"
import { bucketLabel } from "@/components/tasks/time-wheel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  describeRotation,
  autoDayName,
  describeTaskRrule,
  formatTaskDate,
  isPhaseAuto,
  isAutoPlaced,
  parseByday,
  isPinnedWeekly,
  scheduleDetail,
  withUntil,
} from "@/lib/recurrence"
import { cn } from "@/lib/utils"
import type { MemberBrief } from "@/lib/types/calendar"
import type { RoutineOut, TaskCreatePayload, TaskOut } from "@/lib/types/task"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/** Return a copy of `list` with items at `i` and `j` swapped. */
function swapped<T>(list: T[], i: number, j: number): T[] {
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export default function TasksPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const api = useApi()

  useRealtime(familyId)

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
  })
  const { data: routines = [], isLoading: routinesLoading } = useRoutines(familyId)
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(familyId)

  const createTask = useCreateTask(familyId)
  const updateTask = useUpdateTask(familyId)
  const deleteTask = useDeleteTask(familyId)
  const createRoutine = useCreateRoutine(familyId)

  // Reorder tasks within a routine / the Anytime group by writing sequential
  // sort_order to any task whose position changed (lists sort by sort_order, title).
  function persistOrder(ordered: TaskOut[]) {
    ordered.forEach((t, idx) => {
      if (t.sort_order !== idx) updateTask.mutate({ taskId: t.id, data: { sort_order: idx } })
    })
  }

  const [sheetOpen, setSheetOpen] = useState(false)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [editing, setEditing] = useState<TaskOut | undefined>()
  const [defaultRoutineId, setDefaultRoutineId] = useState<string | undefined>()
  const [addingRoutine, setAddingRoutine] = useState(false)
  const [routineName, setRoutineName] = useState("")
  // Bring the add-routine form into view when it opens so its button isn't below the fold.
  const addRoutineFormRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (addingRoutine) {
      addRoutineFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [addingRoutine])

  const ungrouped = tasks.filter((t) => !t.routine_id)
  const isLoading = routinesLoading || tasksLoading

  function openCreate(routineId?: string) {
    setEditing(undefined)
    setDefaultRoutineId(routineId)
    setSheetOpen(true)
  }

  function openEdit(task: TaskOut) {
    setEditing(task)
    setDefaultRoutineId(undefined)
    setSheetOpen(true)
  }

  async function handleSubmit(values: TaskFormValues) {
    const rotating = values.rotate && values.member_ids.length >= 2
    const phasePinned =
      values.rrule !== "none" && isPhaseAuto(values.rrule) && values.start_pinned
    const data: TaskCreatePayload = {
      title: values.title.trim(),
      icon: values.icon.trim() || null,
      description: values.description?.trim() ? values.description.trim() : null,
      routine_id: values.routine_id === NO_ROUTINE ? null : values.routine_id,
      color: values.color,
      // One-offs always carry their due date. A recurring chore sends a date only when
      // it shouldn't start right away ("Not before"); editing never re-dates it.
      // An every-N-days / monthly chore with a chosen start date sends it too.
      ...(values.rrule === "none" || phasePinned
        ? { start_date: values.start_date }
        : !editing && !values.starts_immediately
          ? { start_date: values.start_date }
          : {}),
      // True only when the user picked the weekday(s) or the start date themselves.
      day_pinned: isPinnedWeekly(values.rrule) || phasePinned,
      // Splice the optional end date back into the pattern as UNTIL.
      rrule: values.rrule === "none" ? null : withUntil(values.rrule, values.end_date || null),
      // Rotation needs at least two members; otherwise it's just a fixed assignee.
      assignment_strategy: rotating ? "rotating" : "fixed",
      rotation_unit: values.rotation_unit,
      rotation_interval: values.rotation_interval,
      // Anchor only applies to a calendar-based rotation cadence; clear it otherwise.
      rotation_anchor_date:
        rotating && values.rotation_unit !== "occurrence"
          ? values.rotation_anchor_date || null
          : null,
      star_value: values.star_value,
      // 0 in the form means "no estimate" — send null so the column clears.
      estimated_minutes: values.estimated_minutes > 0 ? values.estimated_minutes : null,
      member_ids: values.member_ids,
    }
    const noun = data.rrule ? "Chore" : "To-do"
    try {
      if (editing) {
        const saved = await updateTask.mutateAsync({ taskId: editing.id, data })
        // Say so when the app just (re)chose the day, i.e. it was pinned or the day moved.
        const moved =
          editing.day_pinned || parseByday(editing.rrule)[0] !== parseByday(saved.rrule)[0]
        const day = isAutoPlaced(saved) && moved ? autoDayName(saved.rrule) : null
        const phaseMoved =
          isPhaseAuto(saved.rrule) &&
          !saved.day_pinned &&
          (editing.day_pinned || editing.start_date !== saved.start_date)
        toast.success(
          day
            ? `${noun} updated. Scheduled on ${day} to balance chores.`
            : phaseMoved
              ? `${noun} updated. Starts ${formatTaskDate(saved.start_date)} to balance chores.`
              : `${noun} updated`,
        )
      } else {
        const saved = await createTask.mutateAsync(data)
        const day = isAutoPlaced(saved) ? autoDayName(saved.rrule) : null
        toast.success(
          day
            ? `${noun} created. Scheduled on ${day} to balance chores.`
            : isPhaseAuto(saved.rrule) && !saved.day_pinned
              ? `${noun} created. Starts ${formatTaskDate(saved.start_date)} to balance chores.`
              : `${noun} created`,
        )
      }
      setSheetOpen(false)
    } catch {
      toast.error(`Couldn't save the ${noun.toLowerCase()}. Please try again.`)
    }
  }

  async function handleDelete() {
    if (!editing) return
    try {
      await deleteTask.mutateAsync(editing.id)
      toast.success(`${editing.rrule ? "Chore" : "To-do"} deleted`)
      setSheetOpen(false)
    } catch {
      toast.error(`Couldn't delete the ${editing.rrule ? "chore" : "to-do"}. Please try again.`)
    }
  }

  function handleAddRoutine() {
    const name = routineName.trim()
    if (!name) return
    createRoutine.mutate(
      { name, sort_order: routines.length },
      {
        onSuccess: () => {
          setRoutineName("")
          setAddingRoutine(false)
          toast.success("Routine added")
        },
        onError: () => toast.error("Couldn't add routine. Please try again."),
      },
    )
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 [&>*]:shrink-0">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Chores &amp; to-dos</h1>
        <p className="text-muted-foreground text-sm">
          Chores and habits for your family. Group them into routines like Morning or Bedtime —
          they show up as checkable cards on the device.
        </p>
      </header>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openCreate()}>
            <PlusIcon /> Add
          </Button>
          <Button
            size="sm"
            variant={addingRoutine ? "outline" : "secondary"}
            onClick={() => setAddingRoutine((v) => !v)}
          >
            {addingRoutine ? <XIcon /> : <FolderPlusIcon />}
            {addingRoutine ? "Cancel" : "Add routine"}
          </Button>
          {tasks.some((t) => t.rrule) && (
            <Button size="sm" variant="ghost" onClick={() => setBalanceOpen(true)}>
              <SparklesIcon /> Balance chores
            </Button>
          )}
        </div>
      )}

      {addingRoutine && (
        <form
          ref={addRoutineFormRef}
          onSubmit={(e) => {
            e.preventDefault()
            handleAddRoutine()
          }}
          className="flex items-center gap-2 scroll-mt-4"
        >
          <Input
            value={routineName}
            onChange={(e) => setRoutineName(e.target.value)}
            placeholder="Routine name (e.g. Morning)"
            autoFocus
            maxLength={100}
          />
          <Button type="submit" disabled={createRoutine.isPending || !routineName.trim()}>
            Add
          </Button>
        </form>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : routines.length === 0 && tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <ListChecksIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">No chores or to-dos yet</p>
            <p className="text-muted-foreground text-sm">
              {canManage ? "Add your first chore, to-do or routine to get started." : "Nothing assigned yet."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {routines.map((routine) => (
            <RoutineSection
              key={routine.id}
              familyId={familyId}
              routine={routine}
              canManage={canManage}
              onAddTask={() => openCreate(routine.id)}
              onEditTask={openEdit}
              onReorder={persistOrder}
            />
          ))}

          {ungrouped.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Anytime
              </h2>
              <ul className="flex flex-col gap-2">
                {ungrouped.map((task, idx) => (
                  <TaskRow
                    key={task.id}
                    familyId={familyId}
                    task={task}
                    canManage={canManage}
                    onEdit={() => openEdit(task)}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < ungrouped.length - 1}
                    onMoveUp={() => persistOrder(swapped(ungrouped, idx, idx - 1))}
                    onMoveDown={() => persistOrder(swapped(ungrouped, idx, idx + 1))}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <TaskSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSubmit}
        onDelete={editing ? handleDelete : undefined}
        isPending={createTask.isPending || updateTask.isPending}
        isDeleting={deleteTask.isPending}
        routines={routines}
        members={members}
        defaultRoutineId={defaultRoutineId}
        editing={editing}
      />

      <BalanceSheet
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        familyId={familyId}
        members={members}
        tasks={tasks}
      />
    </div>
  )
}

function RoutineSection({
  familyId,
  routine,
  canManage,
  onAddTask,
  onEditTask,
  onReorder,
}: {
  familyId: string
  routine: RoutineOut
  canManage: boolean
  onAddTask: () => void
  onEditTask: (task: TaskOut) => void
  onReorder: (ordered: TaskOut[]) => void
}) {
  const updateRoutine = useUpdateRoutine(familyId)
  const deleteRoutine = useDeleteRoutine(familyId)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(routine.name)

  function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === routine.name) {
      setRenaming(false)
      setName(routine.name)
      return
    }
    updateRoutine.mutate(
      { routineId: routine.id, data: { name: trimmed } },
      {
        onSuccess: () => {
          setRenaming(false)
          toast.success("Routine renamed")
        },
        onError: () => toast.error("Couldn't rename routine."),
      },
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              saveName()
            }}
            className="flex flex-1 items-center gap-2"
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name">
              <CheckIcon />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel rename"
              onClick={() => {
                setRenaming(false)
                setName(routine.name)
              }}
            >
              <XIcon />
            </Button>
          </form>
        ) : (
          <>
            <h2 className="font-heading flex-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {routine.name}
            </h2>
            {canManage && (
              <>
                <Button size="sm" variant="ghost" onClick={onAddTask}>
                  <PlusIcon /> Chore
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Rename ${routine.name}`}
                  onClick={() => setRenaming(true)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <PencilIcon />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${routine.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete the {routine.name} routine?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Its tasks won&apos;t be deleted — they move to &ldquo;Anytime&rdquo;.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => deleteRoutine.mutate(routine.id)}
                      >
                        Delete routine
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </>
        )}
      </div>

      {routine.tasks.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-3 text-sm">
          No tasks in this routine yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routine.tasks.map((task, idx) => (
            <TaskRow
              key={task.id}
              familyId={familyId}
              task={task}
              canManage={canManage}
              onEdit={() => onEditTask(task)}
              canMoveUp={idx > 0}
              canMoveDown={idx < routine.tasks.length - 1}
              onMoveUp={() => onReorder(swapped(routine.tasks, idx, idx - 1))}
              onMoveDown={() => onReorder(swapped(routine.tasks, idx, idx + 1))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function TaskRow({
  familyId,
  task,
  canManage,
  onEdit,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
}: {
  familyId: string
  task: TaskOut
  canManage: boolean
  onEdit: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const color = task.color ?? task.members[0]?.color ?? "#6366f1"
  const isRecurring = !!task.rrule

  return (
    <li className="bg-card ring-foreground/5 group flex items-center gap-3 rounded-2xl p-3 shadow-sm ring-1">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-tight">
          {task.icon && <span className="mr-1.5">{task.icon}</span>}
          {task.title}
        </p>
        {task.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{task.description}</p>
        )}
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          <CalendarDaysIcon className="size-3 shrink-0" />
          <span className="truncate">
            {scheduleDetail(task)}
            {task.estimated_minutes ? ` · ${bucketLabel(task.estimated_minutes)}` : ""}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{describeTaskRrule(task.rrule, task)}</Badge>
          {task.assignment_strategy === "rotating" && (
            <Badge variant="secondary" className="gap-1">
              <RepeatIcon className="size-3" /> Rotating ·{" "}
              {describeRotation(task.rotation_unit, task.rotation_interval)}
            </Badge>
          )}
          {task.star_value > 0 && (
            <Badge variant="secondary" className="gap-1">
              <StarIcon className="size-3 fill-amber-400 text-amber-400" /> {task.star_value}
            </Badge>
          )}
          {isRecurring &&
            task.members.map((m) => (
              <MemberStreakBadge key={m.id} familyId={familyId} taskId={task.id} member={m} />
            ))}
        </div>
      </div>

      {/* Assigned member avatars */}
      <div className="flex -space-x-1.5">
        {task.members.map((m) => (
          <span
            key={m.id}
            title={m.name}
            className="ring-background flex size-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2"
            style={{ backgroundColor: m.color }}
          >
            {initials(m.name)}
          </span>
        ))}
      </div>

      {canManage && (onMoveUp || onMoveDown) && (
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground size-6"
            aria-label={`Move ${task.title} up`}
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground size-6"
            aria-label={`Move ${task.title} down`}
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <ChevronDownIcon />
          </Button>
        </div>
      )}

      {canManage && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${task.title}`}
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground"
        >
          <PencilIcon />
        </Button>
      )}
    </li>
  )
}

function MemberStreakBadge({
  familyId,
  taskId,
  member,
}: {
  familyId: string
  taskId: string
  member: MemberBrief
}) {
  const { data } = useStreak(familyId, taskId, member.id)
  if (!data || data.current_streak <= 0) return null
  return (
    <span
      title={`${member.name}: ${data.current_streak}-day streak (best ${data.longest_streak})`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      🔥 {data.current_streak}
    </span>
  )
}
