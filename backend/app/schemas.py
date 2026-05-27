from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class StyleRequest(BaseModel):
    color: str = Field(default="#0f7fd6")
    fill_color: str = Field(default="#79b8f5")
    opacity: float = Field(default=0.5, ge=0.0, le=1.0)


class LayerWmsResponse(BaseModel):
    layer_name: str
    workspace: str
    wms_url: str
    params: dict
