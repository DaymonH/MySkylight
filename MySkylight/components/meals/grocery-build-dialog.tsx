"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2Icon, PackageCheckIcon, ShoppingCartIcon, XIcon } from "lucide-react"

import { useLists } from "@/hooks/use-lists"
import { useBuildGrocery } from "@/hooks/use-meals"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { canonName } from "@/lib/recipe-scale"
import { cn } from "@/lib/utils"
import type { AggregatedLine, GroceryBuildItem } from "@/lib/types/meal"

const NEW_LIST = "__new__"

/** Quantity + unit of an aggregated line as the free-text quantity a grocery item uses. */
function lineQuantity(line: AggregatedLine): string {
  if (line.quantity == null) return line.unit ?? ""
  return line.unit ? `${line.quantity} ${line.unit}` : `${line.quantity}`
}

interface Row extends GroceryBuildItem {
  from: string[]
  /** Already in the pantry — left off the list. */
  have: boolean
}

// Pantry staples ("I always have salt") are remembered per browser so they're skipped
// automatically next time. Stored as canonical ingredient names.
const pantryKey = (familyId: string) => `skylight:pantry:${familyId}`

function loadPantry(familyId: string): Set<string> {
  try {
    const raw = localStorage.getItem(pantryKey(familyId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function savePantry(familyId: string, pantry: Set<string>) {
  try {
    localStorage.setItem(pantryKey(familyId), JSON.stringify([...pantry]))
  } catch {
    // Private mode / blocked storage: the toggle still works for this review.
  }
}

/**
 * F28 review step: the aggregated grocery lines are editable here (quantities,
 * names, removals) before they're committed into a new or existing grocery list.
 */
export function GroceryBuildDialog({
  open,
  onClose,
  familyId,
  lines,
  defaultListName,
}: {
  open: boolean
  onClose: () => void
  familyId: string
  lines: AggregatedLine[]
  defaultListName: string
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCartIcon className="size-5" /> Build grocery list
          </DialogTitle>
          <DialogDescription>
            Review the combined ingredients, then add them to a grocery list.
          </DialogDescription>
        </DialogHeader>
        {open && (
          // Mounted only while open so its state resets each time it opens.
          <GroceryBuildBody
            familyId={familyId}
            lines={lines}
            defaultListName={defaultListName}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function GroceryBuildBody({
  familyId,
  lines,
  defaultListName,
  onClose,
}: {
  familyId: string
  lines: AggregatedLine[]
  defaultListName: string
  onClose: () => void
}) {
  const { data: lists = [] } = useLists(familyId)
  const groceryLists = lists.filter((l) => l.list_type === "grocery")
  const build = useBuildGrocery(familyId)

  const [pantry, setPantry] = useState<Set<string>>(() => loadPantry(familyId))
  const [rows, setRows] = useState<Row[]>(() => {
    const staples = loadPantry(familyId)
    return lines.map((l) => ({
      text: l.name,
      quantity: lineQuantity(l) || null,
      from: l.from_recipes,
      have: staples.has(canonName(l.name)),
    }))
  })
  const haveCount = rows.filter((r) => r.have).length

  function toggleHave(idx: number) {
    const row = rows[idx]
    const next = new Set(pantry)
    if (row.have) next.delete(canonName(row.text))
    else next.add(canonName(row.text))
    setPantry(next)
    savePantry(familyId, next)
    // Every line for the same ingredient moves together.
    setRows((rs) =>
      rs.map((r) => (canonName(r.text) === canonName(row.text) ? { ...r, have: !row.have } : r)),
    )
  }
  const [target, setTarget] = useState<string>(NEW_LIST)
  const [listName, setListName] = useState(defaultListName)

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function handleBuild() {
    const items = rows
      .filter((r) => r.text.trim() && !r.have)
      .map((r) => ({ text: r.text.trim(), quantity: r.quantity?.trim() || null }))
    if (items.length === 0) {
      toast.error("Add at least one item.")
      return
    }
    const payload =
      target === NEW_LIST
        ? { list_name: listName.trim() || "Groceries", items }
        : { list_id: target, items }
    build.mutate(payload, {
      onSuccess: (list) => {
        toast.success(`Added ${items.length} item${items.length === 1 ? "" : "s"} to ${list.name}`)
        onClose()
      },
      onError: () => toast.error("Couldn't build the grocery list. Please try again."),
    })
  }

  return (
    <>
      <div className="thin-scrollbar flex-1 overflow-y-auto p-5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Nothing to add — these recipes have no ingredients yet.
          </p>
        ) : (
          <>
          {haveCount > 0 && (
            <p className="text-muted-foreground mb-3 text-xs">
              {haveCount} {haveCount === 1 ? "item is" : "items are"} marked as already in your pantry
              and will be skipped. Tap the box icon to change that.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((row, idx) => (
              <li key={idx} className={cn("flex items-center gap-2", row.have && "opacity-50")}>
                <Input
                  value={row.quantity ?? ""}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                  placeholder="qty"
                  aria-label="Quantity"
                  className="w-24 px-2"
                />
                <div className="min-w-0 flex-1">
                  <Input
                    value={row.text}
                    onChange={(e) => updateRow(idx, { text: e.target.value })}
                    aria-label="Item"
                  />
                  {row.from.length > 0 && (
                    <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
                      {row.from.join(" · ")}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={row.have ? `${row.text}: in pantry (tap to add to list)` : `I already have ${row.text}`}
                  aria-pressed={row.have}
                  title={row.have ? "In your pantry — skipped" : "I already have this"}
                  onClick={() => toggleHave(idx)}
                  className={cn("shrink-0", row.have ? "text-primary" : "text-muted-foreground")}
                >
                  <PackageCheckIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${row.text}`}
                  onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      <DialogFooter className="flex-col gap-3 border-t p-5 sm:flex-col sm:items-stretch">
        <div className="flex flex-col gap-2">
          <Label>Add to</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_LIST}>＋ New grocery list</SelectItem>
              {groceryLists.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target === NEW_LIST && (
            <Input
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="List name"
              maxLength={100}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={handleBuild}
            disabled={build.isPending || rows.length - haveCount === 0}
          >
            {build.isPending ? <Loader2Icon className="animate-spin" /> : <ShoppingCartIcon />}
            Add {rows.length - haveCount} to list
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
