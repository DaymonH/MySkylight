"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ImageIcon, LinkIcon, Loader2Icon, SparklesIcon } from "lucide-react"

import { ApiError } from "@/lib/api-client"
import { encodeUpload } from "@/lib/file-to-base64"
import {
  useExtractRecipeFromImage,
  useExtractRecipeFromLink,
} from "@/hooks/use-magic-import"
import { useCreateRecipe, useSetRecipeImage } from "@/hooks/use-meals"
import { RecipePhotoPicker } from "@/components/meals/recipe-photo-picker"
import { splitRemotePhoto } from "@/lib/recipe-photo"
import {
  RecipeSheet,
  type RecipeFormValues,
  toRecipePayload,
} from "@/components/meals/recipe-sheet"
import { Button } from "@/components/ui/button"
import { FileDropZone } from "@/components/ui/file-drop-zone"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  ImageCandidate,
  RecipeDraft,
  RecipeExtractionResult,
} from "@/lib/types/magic-import"

function draftToForm(d: RecipeDraft): RecipeFormValues {
  return {
    name: d.name,
    description: d.description ?? "",
    instructions: d.instructions ?? "",
    image_url: d.image_url ?? "",
    source_url: d.source_url ?? "",
    servings: d.servings != null ? String(d.servings) : "",
    prep_minutes: d.prep_minutes != null ? String(d.prep_minutes) : "",
    cook_minutes: d.cook_minutes != null ? String(d.cook_minutes) : "",
    tags: d.tags.join(", "),
    ingredients: d.ingredients.length
      ? d.ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity != null ? String(i.quantity) : "",
          unit: i.unit ?? "",
          section: i.section ?? "",
        }))
      : [{ name: "", quantity: "", unit: "", section: "" }],
  }
}

function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 503) {
    return "AI import isn't set up yet — add a Gemini API key on the server."
  }
  return "Couldn't read that recipe. Please try again."
}

export function RecipeImportDialog({
  open,
  onClose,
  familyId,
}: {
  open: boolean
  onClose: () => void
  familyId: string
}) {
  // Mounted only while open so the step/state resets cleanly each time.
  if (!open) return null
  return <ImportFlow familyId={familyId} onClose={onClose} />
}

function ImportFlow({
  familyId,
  onClose,
}: {
  familyId: string
  onClose: () => void
}) {
  const [prefill, setPrefill] = useState<RecipeFormValues | null>(null)
  // After a link import: the recipe read from the page, waiting while the user picks a photo.
  const [choosing, setChoosing] = useState<{
    form: RecipeFormValues
    candidates: ImageCandidate[]
  } | null>(null)
  const [url, setUrl] = useState("")

  const extractImage = useExtractRecipeFromImage(familyId)
  const extractLink = useExtractRecipeFromLink(familyId)
  const createRecipe = useCreateRecipe(familyId)
  const setPhoto = useSetRecipeImage(familyId)
  const busy = extractImage.isPending || extractLink.isPending

  function handleResult(res: RecipeExtractionResult) {
    if (res.recipe) {
      const form = draftToForm(res.recipe)
      const candidates = res.image_candidates ?? []
      // A link import found photos on the page: let the user pick one before reviewing.
      if (candidates.length > 0) setChoosing({ form, candidates })
      else setPrefill(form)
    } else {
      toast.info(res.notes ?? "Couldn't find a recipe — try the other option.")
    }
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return
    let encoded
    try {
      encoded = await encodeUpload(file)
    } catch {
      toast.error("Couldn't read that image.")
      return
    }
    extractImage.mutate(encoded, {
      onSuccess: handleResult,
      onError: (err) => toast.error(aiErrorMessage(err)),
    })
  }

  function onSubmitLink() {
    const u = url.trim()
    if (!u) return
    extractLink.mutate(
      { url: u },
      {
        onSuccess: handleResult,
        onError: (err) => toast.error(aiErrorMessage(err)),
      }
    )
  }

  // Photo step (link import): one candidate at a time until one is confirmed.
  if (choosing) {
    return (
      <RecipePhotoPicker
        recipeName={choosing.form.name}
        candidates={choosing.candidates}
        onChoose={(photo) => {
          setPrefill({ ...choosing.form, image_url: photo ?? "" })
          setChoosing(null)
        }}
      />
    )
  }

  // Review step: reuse the normal recipe form (create mode) seeded with the draft.
  if (prefill) {
    return (
      <RecipeSheet
        open
        onClose={onClose}
        prefill={prefill}
        isPending={createRecipe.isPending || setPhoto.isPending}
        onSubmit={async (values) => {
          // A photo from another site is copied to our server after the recipe exists.
          const { payload, remote } = splitRemotePhoto(toRecipePayload(values))
          try {
            const saved = await createRecipe.mutateAsync(payload)
            if (remote) {
              try {
                await setPhoto.mutateAsync({
                  recipeId: saved.id,
                  url: remote,
                  referer: payload.source_url,
                })
              } catch {
                toast.warning("Recipe added, but its photo couldn't be saved. Edit the recipe to try again.")
                onClose()
                return
              }
            }
            toast.success("Recipe added")
            onClose()
          } catch {
            toast.error("Couldn't save the recipe. Please try again.")
          }
        }}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5" /> Add a recipe with AI
          </DialogTitle>
          <DialogDescription>
            Snap a photo of a recipe or paste a link — we&apos;ll fill in the
            details for you to review.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="photo" className="gap-0">
          <div className="p-5 pb-0">
            <TabsList className="w-full">
              <TabsTrigger value="photo" className="flex-1 gap-1.5">
                <ImageIcon className="size-4" /> Photo
              </TabsTrigger>
              <TabsTrigger value="link" className="flex-1 gap-1.5">
                <LinkIcon className="size-4" /> Link
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="photo"
            className="flex flex-col items-center gap-3 p-5"
          >
            <p className="text-center text-sm text-muted-foreground">
              A clear photo of the recipe card or page works best.
            </p>
            <FileDropZone accept="image/*" onFile={onPickPhoto} disabled={busy}>
              {extractImage.isPending ? (
                <>
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Reading…</span>
                </>
              ) : (
                <>
                  <ImageIcon className="size-6 text-muted-foreground" />
                  <span className="font-medium">Choose a photo</span>
                  <span className="text-xs text-muted-foreground">
                    or drag &amp; drop, or paste an image
                  </span>
                </>
              )}
            </FileDropZone>
          </TabsContent>

          <TabsContent value="link" className="flex flex-col gap-3 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-url">Recipe URL</Label>
              <Input
                id="recipe-url"
                inputMode="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSubmitLink()}
              />
            </div>
            <Button
              onClick={onSubmitLink}
              disabled={busy || !url.trim()}
              className="w-full"
            >
              {extractLink.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SparklesIcon />
              )}
              {extractLink.isPending ? "Reading…" : "Get recipe"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
