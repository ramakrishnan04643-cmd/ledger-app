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
    note: str = ""
    monthly_due: float
    due_day: int

class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    month: str
    due_date: date
    paid_amount: float
    paid_date: Optional[date] = None


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    amount_given: float
    date_given: Optional[date] = None
    note: str = ""
    monthly_due: float


class RecordPaymentRequest(BaseModel):
    month: str            # 'YYYY-MM'
    amount: float


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


# ---------- settings ----------
class SettingsUpdate(BaseModel):
    cash_balance: Optional[float] = None
    savings_goal: Optional[float] = None
    current_savings: Optional[float] = None


class SettingsOut(BaseModel):
    cash_balance: float
    savings_goal: float
    current_savings: float
