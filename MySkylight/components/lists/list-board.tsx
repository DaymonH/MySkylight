"use client"

import type { CSSProperties } from "react"
import {
  CheckIcon,
  ListTodoIcon,
  Loader2Icon,
  PartyPopperIcon,
  ShoppingCartIcon,
} from "lucide-react"

import { useRealtime } from "@/hooks/use-realtime"
import { useLists, useToggleItem } from "@/hooks/use-lists"
import { cn } from "@/lib/utils"
import type { ListItemOut, ListOut } from "@/lib/types/list"

/**
 * The device "lists" surface: one card per family list showing open items as
 * big, satisfying tap targets. Tapping checks an item off (optimistic — the wall
 * display reacts instantly and any other screen catches up over the `list.*` SSE).
 */
export function ListBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)

  const { data: lists = [], isLoading } = useLists(familyId)
  const toggle = useToggleItem(familyId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ListTodoIcon className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Lists</h1>
          <p className="text-muted-foreground text-sm">To-dos &amp; groceries</p>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading lists…
          </div>
        ) : lists.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-2xl">
              <PartyPopperIcon className="size-8" />
            </span>
            <div>
              <p className="font-heading text-xl font-semibold">No lists yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Add a list from the companion app to see it here.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lists.map((list) => (
              <ListCard
                key={list.id}
                list={list}
                onToggle={(item, checked) =>
                  toggle.mutate({ listId: list.id, itemId: item.id, isChecked: !checked })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ListCard({
  list,
  onToggle,
}: {
  list: ListOut
  onToggle: (item: ListItemOut, checked: boolean) => void
}) {
  const Icon = list.list_type === "grocery" ? ShoppingCartIcon : ListTodoIcon
  const active = list.items.filter((i) => !i.is_checked)
  const checkedCount = list.items.length - active.length
  const allDone = list.items.length > 0 && active.length === 0

  return (
    <section className="bg-card ring-foreground/5 flex flex-col gap-4 rounded-3xl p-5 shadow-sm ring-1">
      <header className="flex items-center gap-3">
        <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-2xl">
          <Icon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold leading-tight">{list.name}</p>
          <p className="text-muted-foreground text-sm">
            {active.length} open{checkedCount > 0 ? ` · ${checkedCount} done` : ""}
          </p>
        </div>
        {allDone && (
          <span className="text-2xl" role="img" aria-label="All done">
            🎉
          </span>
        )}
      </header>

      {list.items.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-3 text-sm">
          Empty list.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((item) => (
            <li key={item.id}>
              <ItemButton item={item} done={false} onToggle={() => onToggle(item, false)} />
            </li>
          ))}
          {checkedCount > 0 &&
            list.items
              .filter((i) => i.is_checked)
              .map((item) => (
                <li key={item.id}>
                  <ItemButton item={item} done onToggle={() => onToggle(item, true)} />
                </li>
              ))}
        </ul>
      )}
    </section>
  )
}

function ItemButton({
  item,
  done,
  onToggle,
}: {
  item: ListItemOut
  done: boolean
  onToggle: () => void
}) {
  const accent = item.assignee?.color ?? "var(--primary)"
  const style: CSSProperties = done
    ? { backgroundColor: accent, borderColor: accent }
    : { borderColor: accent }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3 text-left transition-colors",
        "focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2",
        done ? "bg-muted/50" : "hover:bg-muted/40",
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-xl border-2 transition-all"
        style={style}
      >
        {done && <CheckIcon className="size-5 text-white duration-200 animate-in zoom-in-50" />}
      </span>
      <span
        className={cn(
          "flex-1 text-lg font-medium transition-all",
          done && "text-muted-foreground line-through",
        )}
      >
        {item.text}
        {item.quantity && (
          <span className="text-muted-foreground text-base font-normal"> · {item.quantity}</span>
        )}
      </span>
    </button>
  )
}
