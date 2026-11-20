<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_event_verified_kiosk_checkout_contract BEFORE INSERT ON attendance_events
            FOR EACH ROW
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM attendance_idempotency_records
                    WHERE tenant_id = NEW.tenant_id AND id = NEW.idempotency_record_id AND contract_version = 4
                        AND (NEW.checkout_outlet_id IS NULL
                            OR NOT (kiosk_device_id <=> NEW.kiosk_device_id)
                            OR NOT (NEW.authenticated_kiosk_outlet_id <=> NEW.checkout_outlet_id)
                            OR NEW.tenant_membership_id IS NOT NULL
                            OR NOT (NEW.location_verdict <=> 'verified')
                            OR NEW.location_capture_status <> 'provided'
                            OR NEW.location_latitude IS NULL OR NEW.location_longitude IS NULL
                            OR NEW.location_accuracy_meters IS NULL
                            OR NOT (JSON_UNQUOTE(JSON_EXTRACT(NEW.checkout_context, '$.verification')) <=> 'verified'))
                ) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Attendance event must match the verified kiosk checkout contract';
                END IF;
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER attendance_idem_verified_kiosk_checkout_immutable BEFORE UPDATE ON attendance_idempotency_records
            FOR EACH ROW
            BEGIN
                IF OLD.contract_version = 4 AND (
                    NEW.request_hash <> OLD.request_hash OR NEW.operation <> OLD.operation
                    OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.tenant_id <> OLD.tenant_id
                    OR NEW.employee_id <> OLD.employee_id
                    OR NOT (NEW.kiosk_device_id <=> OLD.kiosk_device_id)
                ) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified checkout operation binding is immutable';
                END IF;
            END
            SQL);

        $this->replaceContractCheck("OR (contract_version = 4 AND operation = 'check_out'
            AND tenant_membership_id IS NULL AND kiosk_device_id IS NOT NULL AND checkout_outlet_id IS NOT NULL)");
    }

    public function down(): void
    {
        if (DB::table('attendance_idempotency_records')->where('contract_version', 4)->exists()) {
            throw new RuntimeException('Verified checkout rollback would discard recovery contracts. Keep the schema and compatible readers.');
        }

        $this->replaceContractCheck('');
        DB::unprepared('DROP TRIGGER IF EXISTS attendance_idem_verified_kiosk_checkout_immutable');
        DB::unprepared('DROP TRIGGER IF EXISTS attendance_event_verified_kiosk_checkout_contract');
    }

    private function replaceContractCheck(string $verifiedContract): void
    {
        $checkConstraint = DB::connection()->isMaria() ? 'CONSTRAINT' : 'CHECK';
        DB::statement(<<<SQL
            ALTER TABLE attendance_idempotency_records
                DROP {$checkConstraint} attendance_idem_checkout_contract_check,
                ADD CONSTRAINT attendance_idem_checkout_contract_check CHECK (
                    (contract_version = 1 AND checkout_session_id IS NULL AND checkout_outlet_id IS NULL)
                    OR (contract_version = 2 AND operation = 'check_out'
                        AND ((checkout_session_id IS NULL AND kiosk_device_id IS NULL)
                            OR checkout_outlet_id IS NOT NULL))
                    OR (contract_version = 3 AND operation = 'check_out'
                        AND tenant_membership_id IS NOT NULL AND kiosk_device_id IS NULL AND checkout_outlet_id IS NOT NULL)
                    {$verifiedContract}
                )
            SQL);
    }
};
