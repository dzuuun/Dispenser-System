-- Supports the Students module's status filter and alphabetical paging.
ALTER TABLE students
  ADD INDEX student_list_sort (is_active, last_name, first_name, id),
  ADD INDEX student_name_search (last_name, first_name);
