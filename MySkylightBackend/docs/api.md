# MySkylight API surface

<!-- AUTO-GENERATED — do not edit by hand. Regenerate with `make api`
     (or `python scripts/dump_api.py`) after any router change.
     Source of truth = app/routers/*.py; this is a convenience mirror. -->

**MySkylight API v0.1.0** · 92 routes · 🔒 = requires Clerk JWT
(blank auth = public, or a non-Clerk scheme: webhook=svix, Google callback=OAuth state).
Role tiers (owner/adult/child/viewer) are per-route — see the router source.

Interactive docs (dev only): `/api/docs` · `/api/redoc` · raw spec `/api/openapi.json`

## events

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/events` | 🔒 | `list_events` |
| POST | `/api/v1/families/{family_id}/events` | 🔒 | `create_event` |
| GET | `/api/v1/families/{family_id}/events/occurrences` | 🔒 | `get_occurrences` |
| DELETE | `/api/v1/families/{family_id}/events/{event_id}` | 🔒 | `delete_event` |
| GET | `/api/v1/families/{family_id}/events/{event_id}` | 🔒 | `get_event` |
| PATCH | `/api/v1/families/{family_id}/events/{event_id}` | 🔒 | `update_event` |

## external

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/external/google/callback` |  | `google_callback` |
| GET | `/api/v1/families/{family_id}/external/accounts` | 🔒 | `list_external_accounts` |
| DELETE | `/api/v1/families/{family_id}/external/accounts/{account_id}` | 🔒 | `disconnect_external_account` |
| POST | `/api/v1/families/{family_id}/external/accounts/{account_id}/resync` | 🔒 | `resync_external_account` |
| POST | `/api/v1/families/{family_id}/external/accounts/{account_id}/sync` | 🔒 | `sync_external_account` |
| POST | `/api/v1/families/{family_id}/external/apple/connect` | 🔒 | `apple_connect` |
| PUT | `/api/v1/families/{family_id}/external/calendars/{ext_cal_id}` | 🔒 | `update_external_calendar` |
| POST | `/api/v1/families/{family_id}/external/cleanup-duplicates` | 🔒 | `cleanup_duplicate_events` |
| POST | `/api/v1/families/{family_id}/external/google/authorize` | 🔒 | `google_authorize` |
| POST | `/api/v1/families/{family_id}/external/ics/connect` | 🔒 | `ics_connect` |

## families

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/v1/families` | 🔒 | `create_family` |
| DELETE | `/api/v1/families/{family_id}` | 🔒 | `delete_family` |
| GET | `/api/v1/families/{family_id}` | 🔒 | `get_family` |
| PATCH | `/api/v1/families/{family_id}` | 🔒 | `update_family` |
| PATCH | `/api/v1/families/{family_id}/lock` | 🔒 | `update_lock` |
| POST | `/api/v1/families/{family_id}/lock/verify` | 🔒 | `verify_lock` |
| GET | `/api/v1/families/{family_id}/memberships` | 🔒 | `list_memberships` |

## health

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/health` |  | `health` |
| GET | `/api/v1/version` |  | `version` |

## invitations

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/invitations` | 🔒 | `list_invitations` |
| POST | `/api/v1/families/{family_id}/invitations` | 🔒 | `create_invitation` |
| DELETE | `/api/v1/families/{family_id}/invitations/{invitation_id}` | 🔒 | `revoke_invitation` |
| POST | `/api/v1/invitations/accept` | 🔒 | `accept_invitation` |

## lists

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/lists` | 🔒 | `list_lists` |
| POST | `/api/v1/families/{family_id}/lists` | 🔒 | `create_list` |
| POST | `/api/v1/families/{family_id}/lists/reorder` | 🔒 | `reorder_lists` |
| DELETE | `/api/v1/families/{family_id}/lists/{list_id}` | 🔒 | `delete_list` |
| GET | `/api/v1/families/{family_id}/lists/{list_id}` | 🔒 | `get_list` |
| PATCH | `/api/v1/families/{family_id}/lists/{list_id}` | 🔒 | `update_list` |
| POST | `/api/v1/families/{family_id}/lists/{list_id}/items` | 🔒 | `add_item` |
| POST | `/api/v1/families/{family_id}/lists/{list_id}/items/reorder` | 🔒 | `reorder_items` |
| DELETE | `/api/v1/families/{family_id}/lists/{list_id}/items/{item_id}` | 🔒 | `delete_item` |
| PATCH | `/api/v1/families/{family_id}/lists/{list_id}/items/{item_id}` | 🔒 | `update_item` |

## magic-import

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/v1/families/{family_id}/magic-import/events` | 🔒 | `extract_events` |
| POST | `/api/v1/families/{family_id}/magic-import/recipes/image` | 🔒 | `extract_recipe_from_image` |
| POST | `/api/v1/families/{family_id}/magic-import/recipes/link` | 🔒 | `extract_recipe_from_link` |

## me

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | 🔒 | `get_me` |
| GET | `/api/v1/me/memberships` | 🔒 | `get_my_memberships` |

## meals

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/v1/families/{family_id}/grocery/aggregate` | 🔒 | `aggregate_grocery` |
| POST | `/api/v1/families/{family_id}/grocery/build` | 🔒 | `build_grocery` |
| GET | `/api/v1/families/{family_id}/mealplans` | 🔒 | `list_meals` |
| POST | `/api/v1/families/{family_id}/mealplans` | 🔒 | `create_meal` |
| DELETE | `/api/v1/families/{family_id}/mealplans/{meal_id}` | 🔒 | `delete_meal` |
| PATCH | `/api/v1/families/{family_id}/mealplans/{meal_id}` | 🔒 | `update_meal` |
| POST | `/api/v1/families/{family_id}/mealplans/{meal_id}/to-calendar` | 🔒 | `meal_to_calendar` |
| GET | `/api/v1/families/{family_id}/recipes` | 🔒 | `list_recipes` |
| POST | `/api/v1/families/{family_id}/recipes` | 🔒 | `create_recipe` |
| DELETE | `/api/v1/families/{family_id}/recipes/{recipe_id}` | 🔒 | `delete_recipe` |
| GET | `/api/v1/families/{family_id}/recipes/{recipe_id}` | 🔒 | `get_recipe` |
| PATCH | `/api/v1/families/{family_id}/recipes/{recipe_id}` | 🔒 | `update_recipe` |

## members

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/members` | 🔒 | `list_members` |
| POST | `/api/v1/families/{family_id}/members` | 🔒 | `create_member` |
| DELETE | `/api/v1/families/{family_id}/members/{member_id}` | 🔒 | `delete_member` |
| GET | `/api/v1/families/{family_id}/members/{member_id}` | 🔒 | `get_member` |
| PATCH | `/api/v1/families/{family_id}/members/{member_id}` | 🔒 | `update_member` |

## rewards

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/redemptions` | 🔒 | `list_redemptions` |
| POST | `/api/v1/families/{family_id}/redemptions/{redemption_id}/approve` | 🔒 | `approve_redemption` |
| POST | `/api/v1/families/{family_id}/redemptions/{redemption_id}/reject` | 🔒 | `reject_redemption` |
| GET | `/api/v1/families/{family_id}/rewards` | 🔒 | `list_rewards` |
| POST | `/api/v1/families/{family_id}/rewards` | 🔒 | `create_reward` |
| DELETE | `/api/v1/families/{family_id}/rewards/{reward_id}` | 🔒 | `delete_reward` |
| PATCH | `/api/v1/families/{family_id}/rewards/{reward_id}` | 🔒 | `update_reward` |
| POST | `/api/v1/families/{family_id}/rewards/{reward_id}/redeem` | 🔒 | `redeem_reward` |
| GET | `/api/v1/families/{family_id}/star-balances` | 🔒 | `star_balances` |

## stream

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/stream` | 🔒 | `event_stream` |

## tasks

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/routines` | 🔒 | `list_routines` |
| POST | `/api/v1/families/{family_id}/routines` | 🔒 | `create_routine` |
| DELETE | `/api/v1/families/{family_id}/routines/{routine_id}` | 🔒 | `delete_routine` |
| PATCH | `/api/v1/families/{family_id}/routines/{routine_id}` | 🔒 | `update_routine` |
| GET | `/api/v1/families/{family_id}/tasks` | 🔒 | `list_tasks` |
| POST | `/api/v1/families/{family_id}/tasks` | 🔒 | `create_task` |
| POST | `/api/v1/families/{family_id}/tasks/balance-plan` | 🔒 | `balance_plan` |
| POST | `/api/v1/families/{family_id}/tasks/balance-plan/apply` | 🔒 | `apply_balance_plan` |
| GET | `/api/v1/families/{family_id}/tasks/occurrences` | 🔒 | `get_task_occurrences` |
| DELETE | `/api/v1/families/{family_id}/tasks/{task_id}` | 🔒 | `delete_task` |
| GET | `/api/v1/families/{family_id}/tasks/{task_id}` | 🔒 | `get_task` |
| PATCH | `/api/v1/families/{family_id}/tasks/{task_id}` | 🔒 | `update_task` |
| DELETE | `/api/v1/families/{family_id}/tasks/{task_id}/complete` | 🔒 | `uncomplete_task` |
| POST | `/api/v1/families/{family_id}/tasks/{task_id}/complete` | 🔒 | `complete_task` |
| POST | `/api/v1/families/{family_id}/tasks/{task_id}/move-to-today` | 🔒 | `move_task_to_today` |
| GET | `/api/v1/families/{family_id}/tasks/{task_id}/overrides` | 🔒 | `list_rotation_overrides` |
| DELETE | `/api/v1/families/{family_id}/tasks/{task_id}/overrides/{occurrence_date}` | 🔒 | `clear_rotation_override` |
| PUT | `/api/v1/families/{family_id}/tasks/{task_id}/overrides/{occurrence_date}` | 🔒 | `set_rotation_override` |
| GET | `/api/v1/families/{family_id}/tasks/{task_id}/streak` | 🔒 | `get_streak` |

## weather

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/families/{family_id}/weather` | 🔒 | `fetch_weather` |

## webhooks

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/v1/webhooks/clerk` |  | `clerk_webhook` |
