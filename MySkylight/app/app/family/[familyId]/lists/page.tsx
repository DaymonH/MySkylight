"use client"

import { use, useState, useEffect, useRef, useDeferredValue } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckIcon,
  GripVerticalIcon,
  ListTodoIcon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useAddItem,
  useClearCompleted,
  useCreateList,
  useDeleteItem,
  useDeleteList,
  useListSuggestions,
  useLists,
  useReorderItems,
  useToggleItem,
  useUpdateItem,
  useUpdateList,
} from "@/hooks/use-lists"
import { ListItemSheet, type ListItemFormValues, NO_ASSIGNEE } from "@/components/lists/list-item-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { cn } from "@/lib/utils"
import type { MemberBrief } from "@/lib/types/calendar"
import type { ListItemOut, ListOut, ListType } from "@/lib/types/list"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/** Group active items by category; a single unnamed group when none are categorized. */
function groupByCategory(items: ListItemOut[]): { name: string; items: ListItemOut[] }[] {
  if (!items.some((i) => i.category?.trim())) return [{ name: "", items }]
  const map = new Map<string, ListItemOut[]>()
  for (const it of items) {
    const key = it.category?.trim() || "Other"
    map.set(key, [...(map.get(key) ?? []), it])
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ name, items: list }))
}

export default function ListsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const api = useApi()

  useRealtime(familyId)

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"
  const canEdit = !!role && role !== "viewer"

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
  })
  const { data: lists = [], isLoading } = useLists(familyId)

  const createList = useCreateList(familyId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = lists.find((l) => l.id === selectedId) ?? lists[0]

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState<ListType>("todo")
  // Bring the create-list form into view when it opens so its button isn't below the fold.
  const createFormRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (creating) {
      createFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [creating])

  function handleCreateList() {
    const name = newName.trim()
    if (!name) return
    createList.mutate(
      { name, list_type: newType, sort_order: lists.length },
      {
        onSuccess: (list) => {
          setNewName("")
          setCreating(false)
          setSelectedId(list.id)
          toast.success("List created")
        },
        onError: () => toast.error("Couldn't create the list. Please try again."),
      },
    )
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 [&>*]:shrink-0">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Lists &amp; groceries</h1>
        <p className="text-muted-foreground text-sm">
          Shared to-do and grocery lists the whole family can check off — live on every screen.
        </p>
      </header>

      {/* List selector */}
      <div className="flex flex-wrap items-center gap-2">
        {lists.map((l) => {
          const active = selected?.id === l.id
          const Icon = l.list_type === "grocery" ? ShoppingCartIcon : ListTodoIcon
          const open = l.items.filter((i) => !i.is_checked).length
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelectedId(l.id)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {l.name}
              {open > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs",
                    active ? "bg-primary-foreground/20" : "bg-muted-foreground/15",
                  )}
                >
                  {open}
                </span>
              )}
            </button>
          )
        })}

        {canManage && (
          <Button
            size="sm"
            variant={creating ? "outline" : "secondary"}
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? <XIcon /> : <PlusIcon />}
            {creating ? "Cancel" : "New list"}
          </Button>
        )}
      </div>

      {creating && (
        <form
          ref={createFormRef}
          onSubmit={(e) => {
            e.preventDefault()
            handleCreateList()
          }}
          className="flex flex-col gap-3 rounded-2xl border p-4 scroll-mt-4"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="List name (e.g. Groceries)"
            autoFocus
            maxLength={100}
          />
          <ToggleGroup
            type="single"
            variant="outline"
            value={newType}
            onValueChange={(v) => v && setNewType(v as ListType)}
            className="justify-start"
          >
            <ToggleGroupItem value="todo" className="gap-1.5">
              <ListTodoIcon className="size-4" /> To-do
            </ToggleGroupItem>
            <ToggleGroupItem value="grocery" className="gap-1.5">
              <ShoppingCartIcon className="size-4" /> Grocery
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="submit" disabled={createList.isPending || !newName.trim()} className="self-start">
            Create list
          </Button>
        </form>
      )}

      {/* Selected list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <ListTodoIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">No lists yet</p>
            <p className="text-muted-foreground text-sm">
              {canManage ? "Create your first to-do or grocery list." : "Nothing shared yet."}
            </p>
          </div>
        </div>
      ) : selected ? (
        <ListPanel
          key={selected.id}
          familyId={familyId}
          list={selected}
          members={members}
          canManage={canManage}
          canEdit={canEdit}
          onDeleted={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  )
}

function ListPanel({
  familyId,
  list,
  members,
  canManage,
  canEdit,
  onDeleted,
}: {
  familyId: string
  list: ListOut
  members: MemberBrief[]
  canManage: boolean
  canEdit: boolean
  onDeleted: () => void
}) {
  const addItem = useAddItem(familyId)
  const toggleItem = useToggleItem(familyId)
  const updateItem = useUpdateItem(familyId)
  const deleteItem = useDeleteItem(familyId)
  const updateList = useUpdateList(familyId)
  const deleteList = useDeleteList(familyId)
  const clearCompleted = useClearCompleted(familyId)
  const reorderItems = useReorderItems(familyId)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [quickText, setQuickText] = useState("")
  const [quickFocused, setQuickFocused] = useState(false)
  const deferredText = useDeferredValue(quickText.trim())
  const { data: suggestions = [] } = useListSuggestions(familyId, list.list_type, deferredText)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(list.name)
  const [sheetItem, setSheetItem] = useState<ListItemOut | undefined>()
  const [sheetOpen, setSheetOpen] = useState(false)

  const isGrocery = list.list_type === "grocery"
  const active = list.items.filter((i) => !i.is_checked)
  const completed = list.items.filter((i) => i.is_checked)
  const groups = groupByCategory(active)

  // Adding something already on the list's "Completed" section just un-checks it again
  // instead of creating a duplicate.
  function addOrRestore(text: string, quantity?: string | null, category?: string | null) {
    const done = completed.find((i) => i.text.trim().toLowerCase() === text.toLowerCase())
    if (done) {
      toggleItem.mutate({ listId: list.id, itemId: done.id, isChecked: false })
      setQuickText("")
      return
    }
    addItem.mutate(
      {
        listId: list.id,
        data: { text, ...(quantity ? { quantity } : {}), ...(category ? { category } : {}) },
      },
      {
        onSuccess: () => setQuickText(""),
        onError: () => toast.error("Couldn't add the item. Please try again."),
      },
    )
  }

  function handleQuickAdd() {
    const text = quickText.trim()
    if (!text) return
    // Typing a name you've used before carries over its usual quantity and category.
    const known = suggestions.find((s) => s.text.toLowerCase() === text.toLowerCase())
    addOrRestore(text, known?.quantity, known?.category)
  }

  // Suggestions skip anything already waiting on the list.
  const activeTexts = new Set(active.map((i) => i.text.trim().toLowerCase()))
  const shownSuggestions = suggestions.filter((s) => !activeTexts.has(s.text.toLowerCase())).slice(0, 6)

  function handleDragEnd(groupName: string, groupItems: ListItemOut[], e: DragEndEvent) {
    const { active: dragged, over } = e
    if (!over || dragged.id === over.id) return
    const from = groupItems.findIndex((i) => i.id === dragged.id)
    const to = groupItems.findIndex((i) => i.id === over.id)
    if (from < 0 || to < 0) return
    const moved = arrayMove(groupItems, from, to).map((i) => i.id)
    const order = groups
      .flatMap((g) => (g.name === groupName ? moved : g.items.map((i) => i.id)))
      .concat(completed.map((i) => i.id))
    reorderItems.mutate(
      { listId: list.id, itemIds: order },
      { onError: () => toast.error("Couldn't reorder the list.") },
    )
  }

  function handleClearCompleted() {
    const n = completed.length
    clearCompleted.mutate(list.id, {
      onSuccess: () => toast.success(`Cleared ${n} completed ${n === 1 ? "item" : "items"}`),
      onError: () => toast.error("Couldn't clear the completed items."),
    })
  }

  function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === list.name) {
      setRenaming(false)
      setName(list.name)
      return
    }
    updateList.mutate(
      { listId: list.id, data: { name: trimmed } },
      {
        onSuccess: () => {
          setRenaming(false)
          toast.success("List renamed")
        },
        onError: () => toast.error("Couldn't rename the list."),
      },
    )
  }

  function openEdit(item: ListItemOut) {
    setSheetItem(item)
    setSheetOpen(true)
  }

  function handleSheetSubmit(values: ListItemFormValues) {
    if (!sheetItem) return
    updateItem.mutate(
      {
        listId: list.id,
        itemId: sheetItem.id,
        data: {
          text: values.text.trim(),
          quantity: values.quantity?.trim() ? values.quantity.trim() : null,
          category: values.category?.trim() ? values.category.trim() : null,
          assignee_member_id:
            values.assignee_member_id === NO_ASSIGNEE ? null : values.assignee_member_id,
        },
      },
      {
        onSuccess: () => {
          setSheetOpen(false)
          toast.success("Item updated")
        },
        onError: () => toast.error("Couldn't update the item. Please try again."),
      },
    )
  }

  function handleSheetDelete() {
    if (!sheetItem) return
    deleteItem.mutate(
      { listId: list.id, itemId: sheetItem.id },
      {
        onSuccess: () => {
          setSheetOpen(false)
          toast.success("Item deleted")
        },
        onError: () => toast.error("Couldn't delete the item. Please try again."),
      },
    )
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Header */}
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
                setName(list.name)
              }}
            >
              <XIcon />
            </Button>
          </form>
        ) : (
          <>
            <h2 className="font-heading flex-1 truncate text-lg font-semibold tracking-tight">
              {list.name}
            </h2>
            <Badge variant="secondary" className="gap-1">
              {isGrocery ? <ShoppingCartIcon className="size-3" /> : <ListTodoIcon className="size-3" />}
              {isGrocery ? "Grocery" : "To-do"}
            </Badge>
            {canManage && (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Rename ${list.name}`}
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
                      aria-label={`Delete ${list.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete the {list.name} list?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the list and all its items for everyone in the family.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() =>
                          deleteList.mutate(list.id, {
                            onSuccess: () => {
                              onDeleted()
                              toast.success("List deleted")
                            },
                            onError: () => toast.error("Couldn't delete the list."),
                          })
                        }
                      >
                        Delete list
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </>
        )}
      </div>

      {/* Quick add */}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleQuickAdd()
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onFocus={() => setQuickFocused(true)}
            onBlur={() => setQuickFocused(false)}
            placeholder={isGrocery ? "Add a grocery…" : "Add a to-do…"}
            maxLength={500}
          />
          <Button type="submit" size="icon" aria-label="Add item" disabled={addItem.isPending || !quickText.trim()}>
            <PlusIcon />
          </Button>
        </form>
      )}

      {/* Suggestions from what this family has added before */}
      {canEdit && quickFocused && shownSuggestions.length > 0 && (
        <div
          className="-mt-2 flex flex-wrap gap-1.5"
          // Keep the input focused so tapping a chip doesn't dismiss the row first.
          onPointerDown={(e) => e.preventDefault()}
        >
          {shownSuggestions.map((s) => (
            <button
              key={s.text}
              type="button"
              onClick={() => addOrRestore(s.text, s.quantity, s.category)}
              className="bg-muted hover:bg-muted/70 flex items-center gap-1 rounded-full px-3 py-1 text-sm transition-colors"
            >
              <PlusIcon className="text-muted-foreground size-3.5" />
              {s.text}
              {s.quantity && <span className="text-muted-foreground"> · {s.quantity}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Progress */}
      {list.items.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${(completed.length / list.items.length) * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {completed.length} of {list.items.length} done
          </span>
        </div>
      )}

      {/* Active items */}
      {active.length === 0 && completed.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          This list is empty{canEdit ? " — add the first item above." : "."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.name || "__all__"} className="flex flex-col gap-2">
              {g.name && (
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {g.name}
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleDragEnd(g.name, g.items, e)}
              >
                <SortableContext
                  items={g.items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                  disabled={!canEdit}
                >
                  <ul className="flex flex-col gap-2">
                    {g.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        canEdit={canEdit}
                        sortable
                        onToggle={() =>
                          toggleItem.mutate({ listId: list.id, itemId: item.id, isChecked: true })
                        }
                        onEdit={() => openEdit(item)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
          ))}

          {/* Completed */}
          {completed.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  Completed · {completed.length}
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClearCompleted}
                    disabled={clearCompleted.isPending}
                    className="text-muted-foreground hover:text-foreground h-7"
                  >
                    <Trash2Icon /> Clear
                  </Button>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {completed.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    onToggle={() =>
                      toggleItem.mutate({ listId: list.id, itemId: item.id, isChecked: false })
                    }
                    onEdit={() => openEdit(item)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ListItemSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSheetSubmit}
        onDelete={handleSheetDelete}
        isPending={updateItem.isPending}
        isDeleting={deleteItem.isPending}
        members={members}
        editing={sheetItem}
        showQuantity={isGrocery}
      />
    </section>
  )
}

// dnd-kit's useSortable hands back ref-callbacks + listeners that the React Compiler lint
// flags as "refs during render"; that's its documented usage, so silence the rule here.
/* eslint-disable react-hooks/refs */
function ItemRow({
  item,
  canEdit,
  sortable = false,
  onToggle,
  onEdit,
}: {
  item: ListItemOut
  canEdit: boolean
  /** Show a drag handle (open items only; must sit inside a SortableContext). */
  sortable?: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const checked = item.is_checked
  const sort = useSortable({ id: item.id, disabled: !sortable || !canEdit })
  return (
    <li
      ref={sort.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        zIndex: sort.isDragging ? 10 : undefined,
      }}
      className={cn(
        "bg-card ring-foreground/5 flex items-center gap-3 rounded-2xl p-2.5 pl-3 shadow-sm ring-1",
        sort.isDragging && "shadow-lg ring-primary/30",
      )}
    >
      {sortable && canEdit && (
        <button
          type="button"
          aria-label={`Reorder ${item.text}`}
          className="text-muted-foreground/60 hover:text-foreground -ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          {...sort.attributes}
          {...sort.listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={!canEdit}
        aria-pressed={checked}
        aria-label={checked ? `Uncheck ${item.text}` : `Check ${item.text}`}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors",
          "focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
        )}
      >
        {checked && <CheckIcon className="size-4 duration-200 animate-in zoom-in-50" />}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-medium leading-tight",
            checked && "text-muted-foreground line-through",
          )}
        >
          {item.text}
          {item.quantity && (
            <span className="text-muted-foreground font-normal"> · {item.quantity}</span>
          )}
        </p>
      </div>

      {item.assignee && (
        <span
          title={item.assignee.name}
          className="ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2"
          style={{ backgroundColor: item.assignee.color }}
        >
          {initials(item.assignee.name)}
        </span>
      )}

      {canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${item.text}`}
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground"
        >
          <PencilIcon />
        </Button>
      )}
    </li>
  )
}
/* eslint-enable react-hooks/refs */
