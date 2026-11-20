<?php

use App\Http\Controllers\Api\V1\AccessManagementController;
use App\Http\Controllers\Api\V1\ApprovalController;
use App\Http\Controllers\Api\V1\CorrectionEvidenceController;
use App\Http\Controllers\Api\V1\AttendanceController;
use App\Http\Controllers\Api\V1\AttendanceEvidenceLegalHoldController;
use App\Http\Controllers\Api\V1\AuthSessionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\KioskAccessController;
use App\Http\Controllers\Api\V1\ManagementController;
use App\Http\Controllers\Api\V1\MemberAdministrationController;
use App\Http\Controllers\Api\V1\OwnerPasswordResetController;
use App\Http\Controllers\Api\V1\PlannerNotificationController;
use App\Http\Controllers\Api\V1\ReportingController;
use App\Http\Controllers\Api\V1\SchedulingController;
use App\Http\Controllers\Api\V1\ShiftChangeController;
use App\Http\Controllers\Api\V1\WeeklyPlannerController;
use Illuminate\Support\Facades\Route;

Route::get('/v1/health', HealthController::class)->name('api.v1.health');

Route::prefix('/v1/invitations')->middleware('no-store')->name('api.v1.invitations.')->group(function (): void {
    Route::post('/inspect', [AccessManagementController::class, 'inspectInvitation'])
        ->middleware('throttle:access-invitation')->name('inspect');
    Route::post('/activate', [AccessManagementController::class, 'activateNewUser'])
        ->middleware('throttle:access-invitation')->name('activate');
    Route::post('/login', [AuthSessionController::class, 'loginForInvitation'])
        ->middleware(['throttle:auth-login', 'throttle:access-invitation'])->name('login');
    Route::post('/accept', [AccessManagementController::class, 'acceptForExistingUser'])
        ->middleware(['auth:sanctum', 'throttle:access-invitation'])->name('accept');
});

Route::prefix('/v1/password-resets')->middleware(['no-store', 'throttle:access-invitation'])->group(function (): void {
    Route::post('/inspect', [OwnerPasswordResetController::class, 'inspect']);
    Route::post('/complete', [OwnerPasswordResetController::class, 'consume']);
});

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
        Route::put('/access/members/{membership}/role', [MemberAdministrationController::class, 'changeRole'])->whereNumber('membership')->middleware('throttle:6,1');
        Route::get('/access/members/{membership}/permanent-deletion', [MemberAdministrationController::class, 'preview'])->whereNumber('membership');
        Route::delete('/access/members/{membership}/permanent-deletion', [MemberAdministrationController::class, 'delete'])->whereNumber('membership')->middleware('throttle:6,1');
        Route::post('/access/members/{membership}/password-reset', [OwnerPasswordResetController::class, 'issue'])->whereNumber('membership')->middleware('throttle:6,1');
        Route::post('/access/password-resets/{reset}/revoke', [OwnerPasswordResetController::class, 'revoke'])->whereNumber('reset')->middleware('throttle:6,1');
        Route::get('/access', [AccessManagementController::class, 'index'])->name('access.index');
        Route::post('/access/invitations', [AccessManagementController::class, 'createInvitation'])->name('access.invitations.store');
        Route::post('/access/invitations/{invitation}/cancel', [AccessManagementController::class, 'cancelInvitation'])->whereNumber('invitation')->name('access.invitations.cancel');
        Route::post('/access/invitations/{invitation}/reissue', [AccessManagementController::class, 'reissueInvitation'])->whereNumber('invitation')->name('access.invitations.reissue');
        Route::patch('/access/members/{membership}', [AccessManagementController::class, 'setMemberActive'])->whereNumber('membership')->name('access.members.update');
        Route::delete('/access/members/{membership}', [AccessManagementController::class, 'revokeMember'])->whereNumber('membership')->name('access.members.revoke');
        Route::put('/access/members/{membership}/outlet-scope', [AccessManagementController::class, 'replaceSupervisorScope'])->whereNumber('membership')->name('access.members.scope');
        Route::post('/access/members/{membership}/employee-link', [AccessManagementController::class, 'linkMemberToEmployee'])->whereNumber('membership')->name('access.members.employee-link');
        Route::delete('/access/members/{membership}/employee-link', [AccessManagementController::class, 'unlinkMemberEmployee'])->whereNumber('membership')->name('access.members.employee-unlink');
        Route::post('/business-units', [ManagementController::class, 'createBusinessUnit'])->name('business-units.store');
        Route::put('/business-units/{businessUnit}', [ManagementController::class, 'updateBusinessUnit'])->whereNumber('businessUnit')->name('business-units.update');
        Route::post('/outlets', [ManagementController::class, 'createOutlet'])->name('outlets.store');
        Route::put('/outlets/{outlet}', [ManagementController::class, 'updateOutlet'])->whereNumber('outlet')->name('outlets.update');
        Route::post('/employees', [ManagementController::class, 'createEmployee'])->name('employees.store');
        Route::put('/employees/{employee}', [ManagementController::class, 'updateEmployee'])->whereNumber('employee')->name('employees.update');
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

        Route::get('/notifications', [PlannerNotificationController::class, 'index']);
        Route::post('/notifications/{notification}/read', [PlannerNotificationController::class, 'read'])->whereNumber('notification');

        Route::prefix('/scheduling/me/changes')->controller(ShiftChangeController::class)->group(function (): void {
            Route::get('/', 'index');
            Route::get('/options', 'options');
            Route::post('/', 'store');
            Route::post('/{change}/respond', 'respond')->whereNumber('change');
        });

        Route::prefix('/scheduling/planner/outlets/{outlet}/weeks/{weekStart}')
            ->where(['outlet' => '[0-9]+', 'weekStart' => '[0-9]{4}-[0-9]{2}-[0-9]{2}'])
            ->controller(WeeklyPlannerController::class)->group(function (): void {
                Route::get('/', 'show');
                Route::put('/draft', 'save');
                Route::post('/copy', 'copy');
                Route::post('/validate', 'validate');
                Route::post('/publish', 'publish');
            });

        Route::get('/attendance', [AttendanceController::class, 'managementIndex'])->name('attendance.index');
        Route::get('/attendance/events/{event}/evidence', [AttendanceController::class, 'evidence'])
            ->whereNumber('event')->name('attendance.events.evidence');
        Route::get('/attendance/legal-holds', [AttendanceEvidenceLegalHoldController::class, 'index'])->name('attendance.legal-holds.index');
        Route::post('/attendance/events/{event}/legal-hold-requests', [AttendanceEvidenceLegalHoldController::class, 'requestPlacement'])
            ->whereNumber('event')->name('attendance.legal-holds.requests.store');
        Route::post('/attendance/legal-hold-requests/{holdRequest}/approve', [AttendanceEvidenceLegalHoldController::class, 'approve'])
            ->whereNumber('holdRequest')->name('attendance.legal-holds.requests.approve');
        Route::post('/attendance/legal-hold-requests/{holdRequest}/reject', [AttendanceEvidenceLegalHoldController::class, 'reject'])
            ->whereNumber('holdRequest')->name('attendance.legal-holds.requests.reject');
        Route::post('/attendance/legal-holds/{hold}/extension-requests', [AttendanceEvidenceLegalHoldController::class, 'requestExtension'])
            ->whereNumber('hold')->name('attendance.legal-holds.extensions.store');
        Route::post('/attendance/legal-holds/{hold}/release', [AttendanceEvidenceLegalHoldController::class, 'release'])
            ->whereNumber('hold')->name('attendance.legal-holds.release');
        Route::match(['get', 'put'], '/correction-evidence/retention', [CorrectionEvidenceController::class, 'retention']);
        Route::post('/approvals/{approvalRequest}/evidence/requirement', [CorrectionEvidenceController::class, 'requireSupplement'])
            ->whereNumber('approvalRequest')->middleware('throttle:20,1');
        Route::post('/approvals/{approvalRequest}/evidence/{evidence}/hold', [CorrectionEvidenceController::class, 'hold'])
            ->whereNumber(['approvalRequest', 'evidence'])->middleware('throttle:20,1');
        Route::get('/approvals', [ApprovalController::class, 'queue'])->name('approvals.index');
        Route::get('/approvals/{approvalRequest}', [ApprovalController::class, 'show'])->whereNumber('approvalRequest')->name('approvals.show');
        Route::post('/approvals/{approvalRequest}/reversal', [ApprovalController::class, 'reverse'])
            ->whereNumber('approvalRequest')->name('approvals.reverse');
        Route::post('/approvals/{approvalRequest}/decision', [ApprovalController::class, 'decide'])
            ->whereNumber('approvalRequest')->name('approvals.decide');
        Route::post('/attendance/sessions/{session}/corrections', [ApprovalController::class, 'administrativeCorrection'])
            ->whereNumber('session')->name('attendance.corrections.store');
        Route::post('/attendance/reconstructions', [ApprovalController::class, 'managedReconstruction'])
            ->name('attendance.reconstructions.store');
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
        Route::get('/events/{event}/evidence', 'personalEvidence')
            ->whereNumber('event')->middleware('throttle:60,1')->name('evidence');
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

Route::prefix('/v1/correction-evidence/{approvalRequest}')
    ->where(['approvalRequest' => '[0-9]+'])->middleware(['auth:sanctum', 'active-tenant', 'no-store'])
    ->controller(CorrectionEvidenceController::class)->group(function (): void {
        Route::get('/', 'index');
        Route::post('/', 'upload')->middleware('throttle:20,1');
        Route::get('/{evidence}', 'download')->whereNumber('evidence')->middleware('throttle:60,1');
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
