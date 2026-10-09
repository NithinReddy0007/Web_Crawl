from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
import datetime
import uuid
from database import Base

class Scan(Base):
    __tablename__ = "scans"
    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    url = Column(String, index=True)
    status = Column(String, default="queued") # queued, running, completed, completed_with_errors, failed, cancelled
    max_depth = Column(Integer, default=1)
    max_pages = Column(Integer, default=10)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    pages = relationship("Page", back_populates="scan")
    findings = relationship("Finding", back_populates="scan")

class Page(Base):
    __tablename__ = "pages"
    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(String, ForeignKey("scans.id"))
    url = Column(String)
    title = Column(String, nullable=True)
    status_code = Column(Integer, nullable=True)
    parent_url = Column(String, nullable=True)
    depth = Column(Integer)
    
    scan = relationship("Scan", back_populates="pages")

class Finding(Base):
    __tablename__ = "findings"
    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(String, ForeignKey("scans.id"))
    category = Column(String) # page error, broken link, API failure, resource failure, JavaScript error
    severity = Column(String)
    affected_page_url = Column(String)
    failed_request_url = Column(String, nullable=True)
    status_or_error = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
    scan = relationship("Scan", back_populates="findings")
