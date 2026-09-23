-- NDMU Credentials Dispenser: student import export for Microsoft SQL Server.
-- The output columns match the Student Import XLSX template exactly.
-- Update the academic period before running, then export the result as XLSX.

DECLARE @SchoolYear varchar(9) = '2026-2027';
DECLARE @Semester int = 1;

SELECT
    LTRIM(RTRIM(S.StudentID)) AS SchoolID,
    LTRIM(RTRIM(S.LastName)) AS LastName,
    LTRIM(RTRIM(S.FirstName)) AS FirstName,
    NULLIF(LTRIM(RTRIM(S.MiddleName)), '') AS MiddleName,
    CONVERT(char(10), CAST(S.Birthday AS date), 23) AS BirthDate,
    LTRIM(RTRIM(S.CourseCode)) AS CourseCode
FROM dbo.Student AS S
INNER JOIN dbo.StudentSemestralInfo AS SSI
    ON SSI.StudentID = S.StudentID
INNER JOIN dbo.Course AS C
    ON C.CourseCode = S.CourseCode
WHERE SSI.SchoolYear = @SchoolYear
  AND SSI.Semester = @Semester
  AND SSI.IsEnrolled = 1
  -- Require at least one valid enrolled subject load without multiplying rows.
  AND EXISTS (
      SELECT 1
      FROM dbo.StudentLoad AS SL
      INNER JOIN dbo.Schedule AS SCH
          ON SCH.ScheduleCode = SL.ScheduleCode
      INNER JOIN dbo.Subject AS SUB
          ON SUB.SubjectCode = SCH.SubjectCode
      WHERE SL.StudentID = SSI.StudentID
        AND SL.SchoolYear = SSI.SchoolYear
        AND SL.Semester = SSI.Semester
  )
ORDER BY
    S.LastName,
    S.FirstName,
    S.MiddleName,
    S.StudentID;

-- Before importing, ensure every CourseCode above exists as an active course
-- in the Credentials Dispenser. The import expects YYYY-MM-DD BirthDate values.
