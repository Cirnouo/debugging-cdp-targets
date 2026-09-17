# Test rules

Develop changed domain behavior test-first and observe focused failures before
implementation. Use literal identity fixtures and test actual observable
effects. Replace external process/daemon operations only at their I/O boundary.
Keep all tests outside the Skill payload. Do not launch or close real user
targets or download packages in the regression suite.
