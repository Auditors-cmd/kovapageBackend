
# Database Documentation Checklist
# Generated: 2026-01-03T19:45:21.865Z

## Schema Elements to Document

### Tables (2)
- [ ] otps (BASE TABLE)
- [ ] users (BASE TABLE)

### Total Columns: 19

### Constraints (14)
- [ ] CHECK: otps_createdAt_not_null on otps
- [ ] CHECK: otps_email_not_null on otps
- [ ] CHECK: otps_expiresAt_not_null on otps
- [ ] CHECK: otps_id_not_null on otps
- [ ] CHECK: otps_otp_not_null on otps
- [ ] CHECK: otps_updatedAt_not_null on otps
- [ ] PRIMARY KEY: otps_pkey on otps
- [ ] CHECK: users_createdAt_not_null on users
- [ ] CHECK: users_email_not_null on users
- [ ] CHECK: users_id_not_null on users
- [ ] CHECK: users_name_not_null on users
- [ ] CHECK: users_updatedAt_not_null on users
- [ ] PRIMARY KEY: users_pkey on users
- [ ] UNIQUE: users_email_key on users

### Indexes (3)
- [ ] otps_email on otps
- [ ] otps_expires_at on otps
- [ ] users_email_key on users

### Enum Types (2)
- [ ] enum_users_authMethod: email_otp, password
- [ ] enum_users_role: auditor, manager, admin

## Verification Status
✅ - Documented
❌ - Missing
⚠️  - Not applicable
    