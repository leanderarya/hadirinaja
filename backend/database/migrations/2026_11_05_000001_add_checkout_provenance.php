<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE attendance_idempotency_records
                ADD COLUMN contract_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
                ADD COLUMN checkout_session_id BIGINT UNSIGNED NULL,
                ADD COLUMN checkout_outlet_id BIGINT UNSIGNED NULL,
                ADD UNIQUE KEY attendance_idem_checkout_identity
                    (tenant_id, id, employee_id, checkout_session_id, checkout_outlet_id),
                ADD KEY attendance_idem_checkout_session_index (tenant_id, employee_id, checkout_session_id),
                ADD KEY attendance_idem_checkout_outlet_index (tenant_id, checkout_outlet_id),
                ADD KEY attendance_idem_checkout_kiosk_index (tenant_id, kiosk_device_id, checkout_outlet_id),
                ADD CONSTRAINT attendance_idem_checkout_session_foreign
                    FOREIGN KEY (tenant_id, employee_id, checkout_session_id)
                    REFERENCES attendance_sessions (tenant_id, employee_id, id),
                ADD CONSTRAINT attendance_idem_checkout_outlet_foreign
                    FOREIGN KEY (tenant_id, checkout_outlet_id) REFERENCES outlets (tenant_id, id),
                ADD CONSTRAINT attendance_idem_checkout_kiosk_foreign
                    FOREIGN KEY (tenant_id, kiosk_device_id, checkout_outlet_id)
                    REFERENCES kiosk_devices (tenant_id, id, outlet_id),
                ADD CONSTRAINT attendance_idem_checkout_contract_check CHECK (
                    (contract_version = 1 AND checkout_session_id IS NULL AND checkout_outlet_id IS NULL)
                    OR (contract_version = 2 AND operation = 'check_out'
                        AND ((checkout_session_id IS NULL AND kiosk_device_id IS NULL)
                            OR checkout_outlet_id IS NOT NULL))
                )
            SQL);

        // The generated value keeps the legacy kiosk-at-origin FK semantics for old rows and writers.
        DB::statement(<<<'SQL'
            ALTER TABLE attendance_events
                DROP FOREIGN KEY attendance_event_kiosk_outlet_foreign,
                ADD COLUMN checkout_outlet_id BIGINT UNSIGNED NULL,
                ADD COLUMN authenticated_kiosk_outlet_id BIGINT UNSIGNED NULL,
                ADD COLUMN checkout_context JSON NULL,
                ADD COLUMN kiosk_binding_outlet_id BIGINT UNSIGNED
                    GENERATED ALWAYS AS (COALESCE(authenticated_kiosk_outlet_id, outlet_id)) STORED,
                ADD KEY attendance_event_kiosk_binding_index (tenant_id, kiosk_device_id, kiosk_binding_outlet_id),
                ADD KEY attendance_event_checkout_binding_index
                    (tenant_id, idempotency_record_id, employee_id, attendance_session_id, checkout_outlet_id),
                ADD CONSTRAINT attendance_event_kiosk_binding_foreign
                    FOREIGN KEY (tenant_id, kiosk_device_id, kiosk_binding_outlet_id)
                    REFERENCES kiosk_devices (tenant_id, id, outlet_id),
                ADD CONSTRAINT attendance_event_checkout_binding_foreign
                    FOREIGN KEY (tenant_id, idempotency_record_id, employee_id, attendance_session_id, checkout_outlet_id)
                    REFERENCES attendance_idempotency_records
                        (tenant_id, id, employee_id, checkout_session_id, checkout_outlet_id),
                ADD CONSTRAINT attendance_event_checkout_context_check CHECK (
                    (checkout_outlet_id IS NULL AND checkout_context IS NULL)
                    OR (event_type = 'check_out' AND checkout_outlet_id IS NOT NULL
                        AND checkout_context IS NOT NULL AND JSON_TYPE(checkout_context) = 'OBJECT')
                ),
                ADD CONSTRAINT attendance_event_authenticated_outlet_check CHECK (
                    (authenticated_kiosk_outlet_id IS NULL
                        AND (origin = 'personal' OR checkout_outlet_id IS NULL))
                    OR (origin = 'kiosk' AND authenticated_kiosk_outlet_id IS NOT NULL
                        AND authenticated_kiosk_outlet_id = COALESCE(checkout_outlet_id, outlet_id))
                )
            SQL);

        // A nullable composite FK alone lets a bound checkout omit its provenance or swap actors.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_event_checkout_contract BEFORE INSERT ON attendance_events
            FOR EACH ROW
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM attendance_idempotency_records
                    WHERE tenant_id = NEW.tenant_id AND id = NEW.idempotency_record_id AND contract_version = 2
                        AND (NEW.checkout_outlet_id IS NULL
                            OR NOT (tenant_membership_id <=> NEW.tenant_membership_id)
                            OR NOT (kiosk_device_id <=> NEW.kiosk_device_id))
                ) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attendance event must match the checkout contract';
                END IF;
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_event_checkout_immutable BEFORE UPDATE ON attendance_events
            FOR EACH ROW
            BEGIN
                IF OLD.checkout_outlet_id IS NOT NULL OR OLD.authenticated_kiosk_outlet_id IS NOT NULL
                    OR NEW.checkout_outlet_id IS NOT NULL OR NEW.checkout_context IS NOT NULL
                    OR NEW.authenticated_kiosk_outlet_id IS NOT NULL THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attendance provenance is append-only';
                END IF;
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_event_checkout_no_delete BEFORE DELETE ON attendance_events
            FOR EACH ROW
            BEGIN
                IF OLD.checkout_outlet_id IS NOT NULL OR OLD.authenticated_kiosk_outlet_id IS NOT NULL THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attendance provenance is append-only';
                END IF;
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_idem_checkout_immutable BEFORE UPDATE ON attendance_idempotency_records
            FOR EACH ROW
            BEGIN
                IF NEW.contract_version <> OLD.contract_version
                    OR NOT (NEW.checkout_session_id <=> OLD.checkout_session_id)
                    OR NOT (NEW.checkout_outlet_id <=> OLD.checkout_outlet_id)
                    OR (OLD.contract_version = 2 AND (
                        NEW.request_hash <> OLD.request_hash OR NEW.operation <> OLD.operation
                        OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.tenant_id <> OLD.tenant_id
                        OR NEW.employee_id <> OLD.employee_id
                        OR NOT (NEW.tenant_membership_id <=> OLD.tenant_membership_id)
                        OR NOT (NEW.kiosk_device_id <=> OLD.kiosk_device_id)
                    )) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkout operation binding is immutable';
                END IF;
            END
            SQL);
    }

    public function down(): void
    {
        if (DB::table('attendance_idempotency_records')->where('contract_version', '<>', 1)->exists()
            || DB::table('attendance_events')->whereNotNull('authenticated_kiosk_outlet_id')->exists()) {
            throw new RuntimeException('Checkout provenance rollback would discard recorded bindings. Keep the schema and compatible recovery readers.');
        }

        DB::unprepared('DROP TRIGGER IF EXISTS attendance_idem_checkout_immutable');
        DB::unprepared('DROP TRIGGER IF EXISTS attendance_event_checkout_no_delete');
        DB::unprepared('DROP TRIGGER IF EXISTS attendance_event_checkout_immutable');
        DB::unprepared('DROP TRIGGER IF EXISTS attendance_event_checkout_contract');

        $checkConstraint = DB::connection()->isMaria() ? 'CONSTRAINT' : 'CHECK';
        DB::statement(<<<SQL
            ALTER TABLE attendance_events
                DROP FOREIGN KEY attendance_event_checkout_binding_foreign,
                DROP FOREIGN KEY attendance_event_kiosk_binding_foreign,
                DROP {$checkConstraint} attendance_event_checkout_context_check,
                DROP {$checkConstraint} attendance_event_authenticated_outlet_check,
                DROP INDEX attendance_event_checkout_binding_index,
                DROP INDEX attendance_event_kiosk_binding_index,
                DROP COLUMN kiosk_binding_outlet_id,
                DROP COLUMN authenticated_kiosk_outlet_id,
                DROP COLUMN checkout_outlet_id,
                DROP COLUMN checkout_context,
                ADD CONSTRAINT attendance_event_kiosk_outlet_foreign
                    FOREIGN KEY (tenant_id, kiosk_device_id, outlet_id)
                    REFERENCES kiosk_devices (tenant_id, id, outlet_id) ON DELETE RESTRICT
            SQL);

        DB::statement(<<<SQL
            ALTER TABLE attendance_idempotency_records
                DROP FOREIGN KEY attendance_idem_checkout_session_foreign,
                DROP FOREIGN KEY attendance_idem_checkout_outlet_foreign,
                DROP FOREIGN KEY attendance_idem_checkout_kiosk_foreign,
                DROP {$checkConstraint} attendance_idem_checkout_contract_check,
                DROP INDEX attendance_idem_checkout_identity,
                DROP INDEX attendance_idem_checkout_session_index,
                DROP INDEX attendance_idem_checkout_outlet_index,
                DROP INDEX attendance_idem_checkout_kiosk_index,
                DROP COLUMN checkout_outlet_id,
                DROP COLUMN checkout_session_id,
                DROP COLUMN contract_version
            SQL);
    }
};
