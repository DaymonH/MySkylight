import uuid
from datetime import datetime

from pydantic import BaseModel


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    clerk_user_id: str
    email: str
    first_name: str | None
    last_name: str | None
    image_url: str | None
    created_at: datetime
