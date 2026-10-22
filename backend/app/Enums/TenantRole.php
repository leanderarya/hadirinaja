<?php

namespace App\Enums;

enum TenantRole: string
{
    case Owner = 'owner';
    case Supervisor = 'supervisor';
    case Employee = 'employee';
}
