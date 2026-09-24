ALTER TABLE occasions
  ADD COLUMN meeting_date DATE NULL AFTER target_profile_type,
  ADD COLUMN meeting_start_time TIME NULL AFTER meeting_date,
  ADD COLUMN meeting_end_time TIME NULL AFTER meeting_start_time;

ALTER TABLE occasions
  ADD KEY occasions_meeting_date_idx (meeting_date, status);
