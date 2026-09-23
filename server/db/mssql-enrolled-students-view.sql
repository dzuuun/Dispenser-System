-- Microsoft SQL Server source view for the Credentials Dispenser.
-- Run this in the registrar database. The application filters the view by
-- SchoolYear and Semester using values selected by the administrator.

CREATE OR ALTER VIEW dbo.vw_CredentialsDispenserStudents AS
SELECT
    LTRIM(RTRIM(S.StudentID)) AS SchoolID,
    LTRIM(RTRIM(S.LastName)) AS LastName,
    LTRIM(RTRIM(S.FirstName)) AS FirstName,
    NULLIF(LTRIM(RTRIM(S.MiddleName)), '') AS MiddleName,
    CAST(S.Birthday AS date) AS BirthDate,
    LTRIM(RTRIM(S.CourseCode)) AS CourseCode,
    LTRIM(RTRIM(SSI.SchoolYear)) AS SchoolYear,
    SSI.Semester AS Semester
FROM dbo.Student AS S
INNER JOIN dbo.StudentSemestralInfo AS SSI
    ON SSI.StudentID = S.StudentID
INNER JOIN dbo.Course AS C
    ON C.CourseCode = S.CourseCode
WHERE SSI.IsEnrolled = 1
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
  );

-- Grant the least-privilege import account read access to the view only.
-- GRANT SELECT ON dbo.vw_CredentialsDispenserStudents TO credentials_import;
