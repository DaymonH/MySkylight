from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite+aiosqlite:///./myskylight.db"
    cors_origins: str = "http://localhost:3000"

    # Clerk
    clerk_secret_key: str
    clerk_jwks_url: str
    clerk_webhook_secret: str

    # Child PIN hashing pepper
    pin_pepper: str = "change-me"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"


settings = Settings()  # type: ignore[call-arg]
