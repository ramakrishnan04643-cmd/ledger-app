from sqlalchemy import Column, Integer, String, Float, Boolean, Date, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    amount_given = Column(Float, default=0)       # principal you lent them, one-time
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
    paid_date = Column(Date, nullable=True)          # date of most recent payment towards this month

    person = relationship("Person", back_populates="payments")


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
