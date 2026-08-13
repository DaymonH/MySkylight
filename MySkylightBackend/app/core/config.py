from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite+aiosqlite:///./myskylight.db"
    cors_origins: str = "http://localhost:3000"
    # Comma-separated allowed Host headers; "*" disables the check (dev default).
    allowed_hosts: str = "*"

    # Clerk
    clerk_secret_key: str
    clerk_jwks_url: str
    clerk_webhook_secret: str

    # Child PIN hashing pepper
    pin_pepper: str = "change-me"

    # Background weather-cache refresh (APScheduler)
    weather_refresh_enabled: bool = True
    weather_refresh_minutes: int = 30

    # Google Calendar read-only sync (F18). Populate via env to enable the connect
    # flow; left blank, the authorize endpoint returns 503. Never commit real values.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Must match a redirect URI registered on the Google Cloud OAuth client.
    google_redirect_uri: str = "http://localhost:8001/api/v1/external/google/callback"
    # Where the OAuth callback sends the browser back to once an account is linked.
    frontend_url: str = "http://localhost:3000"

    # Background poll that pulls mapped external calendars into their local mirror
    # (F18/F20). Off → no scheduled sync (manual sync + connect still work).
    external_sync_enabled: bool = True
    # 5 min keeps mirrored calendars fresh while staying a polite CalDAV poller;
    # idle ticks are near-free (delta sync fetches bodies only when something
    # changed). Override per-env with EXTERNAL_SYNC_MINUTES.
    external_sync_minutes: int = 5

    # Apple/iCloud (F20) needs no server-side secret — the user supplies their
    # Apple ID + app-specific password. This is just the CalDAV discovery root.
    apple_caldav_url: str = "https://caldav.icloud.com"

    # Google Gemini (Magic Import, F17). A vision LLM that does OCR + structured
    # extraction in one call. Left blank, the /magic-import endpoints return 503.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"

    @property
    def google_oauth_configured(self) -> bool:
        """True only when both halves of the Google OAuth client are present."""
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def gemini_configured(self) -> bool:
        """True when a Gemini API key is present (Magic Import enabled)."""
        return bool(self.gemini_api_key)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"


settings = Settings()  # type: ignore[call-arg]
