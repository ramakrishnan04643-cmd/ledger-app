from datetime import date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ---------- auth ----------
class LoginRequest(BaseModel):
    password: str


class SetPasswordRequest(BaseModel):
    password: str


# ---------- people ----------
class PersonCreate(BaseModel):
    name: str
    amount_given: float = 0
    date_given: Optional[date] = None
    monthly_due: float
    due_day: int


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    month: str
    due_date: date
    paid_amount: float
    paid_date: Optional[date] = None
    note: str = ""


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    amount_given: float
    date_given: Optional[date] = None
    monthly_due: float
    due_day: int
    archived: bool
    payments: List[PaymentOut] = []


class RecordPaymentRequest(BaseModel):
    month: str            # 'YYYY-MM'
    amount: float
    note: str = ""
    paid_date: Optional[date] = None    # defaults to today if not given


class CompletePaymentRequest(BaseModel):
    month: str
    note: str = ""
    paid_date: Optional[date] = None


# ---------- expenses ----------
class ExpenseCreate(BaseModel):
    date: date
    category: str
    amount: float
    note: str = ""


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    category: str
    amount: float
    note: str


class ExpenseCategoryCreate(BaseModel):
    name: str


class ExpenseCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


# ---------- savings log ----------
class SavingsEntryCreate(BaseModel):
    date: date
    amount: float
    note: str = ""


class SavingsEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    amount: float
    note: str


# ---------- settings ----------
class SettingsUpdate(BaseModel):
    cash_balance: Optional[float] = None
    savings_goal: Optional[float] = None
    current_savings: Optional[float] = None


class SettingsOut(BaseModel):
    cash_balance: float
    savings_goal: float
    current_savings: float


# ---------- push notifications ----------
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str
