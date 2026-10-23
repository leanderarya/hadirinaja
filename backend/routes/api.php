<?php

use App\Http\Controllers\Api\V1\AuthSessionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\KioskAccessController;
use App\Http\Controllers\Api\V1\ManagementController;
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
    });

Route::prefix('/v1/kiosk')->middleware('no-store')->name('api.v1.kiosk.')->group(function (): void {
    Route::post('/pair', [KioskAccessController::class, 'pair'])
        ->middleware('throttle:kiosk-pair')->name('pair');

    Route::middleware(['kiosk-device'])->group(function (): void {
        Route::get('/status', [KioskAccessController::class, 'status'])->name('status');
        Route::post('/pin/enroll', [KioskAccessController::class, 'enrollPin'])
            ->middleware('throttle:kiosk-pin')->name('pin.enroll');
        Route::post('/pin/verify', [KioskAccessController::class, 'verifyPin'])
            ->middleware('throttle:kiosk-pin')->name('pin.verify');
    });
});
