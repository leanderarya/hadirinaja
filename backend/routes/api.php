<?php

use App\Http\Controllers\Api\V1\ApprovalController;
use App\Http\Controllers\Api\V1\AttendanceController;
use App\Http\Controllers\Api\V1\AuthSessionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\KioskAccessController;
use App\Http\Controllers\Api\V1\ManagementController;
use App\Http\Controllers\Api\V1\ReportingController;
use App\Http\Controllers\Api\V1\SchedulingController;
use Illuminate\Support\Facades\Route;

Route::get('/v1/health', HealthController::class)->name('api.v1.health');

Route::prefix('/v1/auth')->middleware('no-store')->name('api.v1.auth.')->group(function (): void {
    Route::post('/login', [AuthSessionController::class, 'login'])
        ->middleware('throttle:auth-login')->name('login');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('/logout', [AuthSessionController::class, 'logout'])->name('logout');
        Route::get('/me', [AuthSessionController::class, 'current'])->name('current');
        Route::get('/tenants', [AuthSessionController::class, 'tenants'])->name('tenants');
        Route::post('/tenant', [AuthSessionController::class, 'selectTenant'])->name('tenant.select');
    });
});

Route::prefix('/v1/management')
    ->middleware(['auth:sanctum', 'active-tenant', 'no-store'])
    ->name('api.v1.management.')
    ->group(function (): void {
        Route::get('/organization', [ManagementController::class, 'organization'])->name('organization');
        Route::get('/employees', [ManagementController::class, 'employees'])->name('employees.index');
        Route::get('/employees/{employee}', [ManagementController::class, 'employee'])->whereNumber('employee')->name('employees.show');
        Route::post('/business-units', [ManagementController::class, 'createBusinessUnit'])->name('business-units.store');
        Route::post('/outlets', [ManagementController::class, 'createOutlet'])->name('outlets.store');
        Route::get('/kiosks', [ManagementController::class, 'kiosks'])->name('kiosks.index');
        Route::post('/kiosks/pairing-codes', [ManagementController::class, 'issuePairingCode'])->name('kiosks.pairing-codes.store');
        Route::post('/kiosks/{device}/revoke', [ManagementController::class, 'revokeKiosk'])->whereNumber('device')->name('kiosks.revoke');
        Route::post('/employees/{employee}/pin-enrollment', [ManagementController::class, 'issuePinEnrollment'])
            ->whereNumber('employee')->name('employees.pin-enrollment');

        Route::prefix('/scheduling')->name('scheduling.')->controller(SchedulingController::class)->group(function (): void {
            Route::get('/context', 'context')->name('context');
            Route::get('/week', 'week')->name('week');
            Route::get('/me/week', 'personalWeek')->name('week.personal');
            Route::post('/resolve', 'resolve')->name('resolve');
            Route::get('/policies', 'policy')->name('policies.show');
            Route::post('/policies/tenant', 'createTenantPolicy')->name('policies.tenant.store');
            Route::post('/outlets/{outlet}/policy', 'createOutletPolicy')->whereNumber('outlet')->name('policies.outlet.store');
            Route::get('/shifts', 'shifts')->name('shifts.index');
            Route::post('/shifts', 'createShift')->name('shifts.store');
            Route::post('/shifts/{template}/versions', 'reviseShift')->whereNumber('template')->name('shifts.versions.store');
            Route::post('/weekly-rules', 'createWeeklyRule')->name('weekly-rules.store');
            Route::post('/exceptions', 'createException')->name('exceptions.store');
            Route::get('/calendar', 'calendar')->name('calendar.show');
            Route::post('/calendar/versions', 'createCalendarVersion')->name('calendar.versions.store');
            Route::post('/calendar/exceptions', 'createCalendarException')->name('calendar.exceptions.store');
            Route::post('/holidays', 'createHoliday')->name('holidays.store');
        });

        Route::get('/attendance', [AttendanceController::class, 'managementIndex'])->name('attendance.index');
        Route::get('/attendance/events/{event}/evidence', [AttendanceController::class, 'evidence'])
            ->whereNumber('event')->name('attendance.events.evidence');
        Route::get('/approvals', [ApprovalController::class, 'queue'])->name('approvals.index');
        Route::get('/approvals/{approvalRequest}', [ApprovalController::class, 'show'])->whereNumber('approvalRequest')->name('approvals.show');
        Route::post('/approvals/{approvalRequest}/decision', [ApprovalController::class, 'decide'])
            ->whereNumber('approvalRequest')->name('approvals.decide');
        Route::post('/attendance/sessions/{session}/corrections', [ApprovalController::class, 'administrativeCorrection'])
            ->whereNumber('session')->name('attendance.corrections.store');
        Route::post('/attendance/reviews/discover', [ApprovalController::class, 'discoverReviews'])->name('attendance.reviews.discover');
        Route::get('/attendance/effective', [ApprovalController::class, 'managementProjection'])->name('attendance.effective');
        Route::post('/attendance/finalizations', [ApprovalController::class, 'finalize'])->name('attendance.finalizations.store');

        Route::prefix('/reports')->name('reports.')->controller(ReportingController::class)->group(function (): void {
            Route::get('/filters', 'filters')->name('filters');
            Route::get('/dashboard', 'dashboard')->name('dashboard');
            Route::get('/attendance', 'attendance')->name('attendance');
            Route::get('/approvals', 'approvals')->name('approvals');
            Route::get('/attendance.csv', 'export')->name('attendance.export');
            Route::get('/audit', 'audit')->name('audit.index');
            Route::get('/audit/{source}/{entry}', 'auditEntry')->where(['source' => '[a-z_]+', 'entry' => '[0-9]+'])->name('audit.show');
        });
    });

Route::prefix('/v1/attendance/me')
    ->middleware(['auth:sanctum', 'active-tenant', 'no-store'])
    ->name('api.v1.attendance.personal.')
    ->controller(AttendanceController::class)
    ->group(function (): void {
        Route::get('/', 'personalCurrent')->name('current');
        Route::post('/check-in', 'personalCheckIn')->name('check-in');
        Route::post('/check-out', 'personalCheckOut')->name('check-out');
        Route::get('/operations/{operation}/{key}', 'personalOperationStatus')
            ->where('operation', 'check_in|check_out')->name('operations.show');
    });

Route::prefix('/v1/attendance/me')
    ->middleware(['auth:sanctum', 'active-tenant', 'no-store'])
    ->name('api.v1.attendance.personal.approvals.')
    ->controller(ApprovalController::class)
    ->group(function (): void {
        Route::get('/requests', 'ownRequests')->name('requests.index');
        Route::post('/requests', 'submit')->name('requests.store');
        Route::post('/requests/{approvalRequest}/cancel', 'cancel')->whereNumber('approvalRequest')->name('requests.cancel');
        Route::get('/effective', 'ownProjection')->name('effective');
    });

Route::prefix('/v1/kiosk')->middleware('no-store')->name('api.v1.kiosk.')->group(function (): void {
    Route::post('/pair', [KioskAccessController::class, 'pair'])
        ->middleware('throttle:kiosk-pair')->name('pair');

    Route::middleware(['kiosk-device'])->group(function (): void {
        Route::get('/status', [KioskAccessController::class, 'status'])->name('status');
        Route::get('/attendance/employees', [AttendanceController::class, 'kioskEmployees'])->name('attendance.employees');
        Route::post('/attendance/next-operation', [AttendanceController::class, 'kioskNextOperation'])
            ->middleware('throttle:kiosk-pin')->name('attendance.next-operation');
        Route::post('/attendance/check-in', [AttendanceController::class, 'kioskCheckIn'])
            ->middleware('throttle:kiosk-pin')->name('attendance.check-in');
        Route::post('/attendance/check-out', [AttendanceController::class, 'kioskCheckOut'])
            ->middleware('throttle:kiosk-pin')->name('attendance.check-out');
        Route::get('/attendance/operations/{operation}/{key}', [AttendanceController::class, 'kioskOperationStatus'])
            ->where('operation', 'check_in|check_out')->name('attendance.operations.show');
        Route::post('/pin/enroll', [KioskAccessController::class, 'enrollPin'])
            ->middleware('throttle:kiosk-pin')->name('pin.enroll');
        Route::post('/pin/verify', [KioskAccessController::class, 'verifyPin'])
            ->middleware('throttle:kiosk-pin')->name('pin.verify');
    });
});
