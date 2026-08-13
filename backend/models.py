from sqlalchemy import Column, Integer, String, Float, Boolean, Date, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    amount_given = Column(Float, default=0)       # principal you lent them, one-time
    date_given = Column(Date, nullable=True)       # date that principal was handed over
    monthly_due = Column(Float, nullable=False)    # what they owe you each month
    due_day = Column(Integer, nullable=False)      # day of month (1-31) it's due
    archived = Column(Boolean, default=False)

    payments = relationship("PersonPayment", back_populates="person", cascade="all, delete-orphan")


class PersonPayment(Base):
    """One row per person per month. paid_amount accumulates as partial
    payments come in; paid_amount >= monthly_due means that month is settled."""
    __tablename__ = "person_payments"

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("people.id"), nullable=False)
    month = Column(String, nullable=False)          # 'YYYY-MM'
    due_date = Column(Date, nullable=False)
    paid_amount = Column(Float, default=0)
    paid_date = Column(Date, nullable=True)          # date this payment was recorded
    note = Column(String, default="")                # optional note on the payment

    person = relationship("Person", back_populates="payments")


class ExpenseCategory(Base):
    """User-managed list of expense categories, so people can add their own
    instead of being stuck with a fixed set."""
    __tablename__ = "expense_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)


class SavingsEntry(Base):
    """A simple monthly savings log: an amount plus a note, separate from the
    single current/goal figures on the dashboard."""
    __tablename__ = "savings_entries"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)
    note = Column(String, default="")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    category = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    note = Column(String, default="")


class Settings(Base):
    """Single-row table for app-wide settings (cash balance, savings goal, password)."""
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, default=1)
    password_hash = Column(String, nullable=True)
    cash_balance = Column(Float, default=0)
    savings_goal = Column(Float, default=0)
    current_savings = Column(Float, default=0)


class PushSubscription(Base):
    """Browser push subscriptions for due-date notifications."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(String, unique=True, nullable=False)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
