<?php

namespace App\Services;

use App\Data\PreparedAttendanceEvidence;
use App\Models\AttendanceEvidence;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class AttendanceEvidenceStorage
{
    public const DISK = 'local';

    private const MIN_WIDTH = 320;

    private const MIN_HEIGHT = 240;

    private const MAX_WIDTH = 1920;

    private const MAX_HEIGHT = 1920;

    public function prepare(UploadedFile $upload, int $tenantId): PreparedAttendanceEvidence
    {
        $sourcePath = $upload->getRealPath();
        $source = is_string($sourcePath) ? @file_get_contents($sourcePath) : false;
        if (! is_string($source) || strlen($source) > 5 * 1024 * 1024) {
            throw ValidationException::withMessages(['photo' => 'Ukuran foto tidak dapat diproses.']);
        }
        $sourceInfo = is_string($source) ? @getimagesizefromstring($source) : false;
        $sourceMime = is_array($sourceInfo) ? ($sourceInfo['mime'] ?? null) : null;

        if (! is_array($sourceInfo) || ! in_array($sourceMime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw ValidationException::withMessages(['photo' => 'Foto tidak dapat dibaca sebagai gambar yang valid.']);
        }

        $sourceWidth = (int) $sourceInfo[0];
        $sourceHeight = (int) $sourceInfo[1];

        if ($sourceWidth > self::MAX_WIDTH || $sourceHeight > self::MAX_HEIGHT) {
            throw ValidationException::withMessages(['photo' => 'Ukuran foto harus antara 320×240 dan 1920×1920 piksel.']);
        }

        $format = config('attendance_evidence.write_format', 'jpeg');
        if (! in_array($format, ['jpeg', 'webp'], true)) {
            throw new RuntimeException('Unsupported attendance evidence output format.');
        }
        if ($format === 'webp' && ! $this->webpEncodingAvailable()) {
            throw new RuntimeException('WebP attendance evidence encoding is unavailable.');
        }

        $this->cleanStaleStagingFiles();

        $image = is_string($source) ? @imagecreatefromstring($source) : false;
        if (! $image instanceof \GdImage) {
            throw ValidationException::withMessages(['photo' => 'Foto tidak dapat dibaca sebagai gambar yang valid.']);
        }

        if ($sourceMime === 'image/jpeg') {
            $image = $this->applyJpegOrientation($image, is_string($sourcePath) ? $sourcePath : '');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        if ($width < self::MIN_WIDTH || $height < self::MIN_HEIGHT
            || $width > self::MAX_WIDTH || $height > self::MAX_HEIGHT) {
            imagedestroy($image);
            throw ValidationException::withMessages(['photo' => 'Ukuran foto harus antara 320×240 dan 1920×1920 piksel.']);
        }

        $normalized = imagecreatetruecolor($width, $height);
        if (! $normalized instanceof \GdImage) {
            imagedestroy($image);
            throw new RuntimeException('Could not allocate a normalized attendance image.');
        }
        $white = imagecolorallocate($normalized, 255, 255, 255);
        imagefill($normalized, 0, 0, $white);
        imagecopy($normalized, $image, 0, 0, 0, 0, $width, $height);
        imagedestroy($image);

        $quality = (int) config($format === 'webp' ? 'attendance_evidence.webp_quality' : 'attendance_evidence.jpeg_quality', $format === 'webp' ? 82 : 85);
        if ($quality < 0 || $quality > 100) {
            imagedestroy($normalized);
            throw new RuntimeException('Invalid attendance evidence encoder quality.');
        }

        ob_start();
        $encoded = $format === 'webp'
            ? imagewebp($normalized, null, $quality)
            : imagejpeg($normalized, null, $quality);
        $bytes = ob_get_clean();
        imagedestroy($normalized);

        $storedMimeType = $format === 'webp' ? 'image/webp' : 'image/jpeg';
        $outputInfo = is_string($bytes) ? @getimagesizefromstring($bytes) : false;
        $outputImage = is_string($bytes) ? @imagecreatefromstring($bytes) : false;
        $maxEncodedBytes = (int) config('attendance_evidence.max_encoded_bytes', 5 * 1024 * 1024);

        if (! $encoded || ! is_string($bytes) || strlen($bytes) < 1024 || strlen($bytes) > $maxEncodedBytes
            || ! is_array($outputInfo) || ($outputInfo['mime'] ?? null) !== $storedMimeType
            || ! $outputImage instanceof \GdImage
            || imagesx($outputImage) !== $width || imagesy($outputImage) !== $height) {
            if ($outputImage instanceof \GdImage) {
                imagedestroy($outputImage);
            }
            throw ValidationException::withMessages(['photo' => 'Foto tidak dapat diproses atau melebihi batas ukuran.']);
        }
        imagedestroy($outputImage);

        $uuid = (string) Str::uuid();
        $extension = $format === 'webp' ? 'webp' : 'jpg';
        $temporaryPath = 'attendance-evidence/.staging/'.$uuid.'.'.$extension;
        $storagePath = 'attendance-evidence/'.$tenantId.'/'.$uuid.'.'.$extension;
        $disk = Storage::disk(self::DISK);

        if (! $disk->put($temporaryPath, $bytes)) {
            $disk->delete($temporaryPath);
            throw new RuntimeException('Could not stage private attendance evidence.');
        }

        return new PreparedAttendanceEvidence(
            temporaryPath: $temporaryPath,
            storagePath: $storagePath,
            detectedMimeType: $sourceMime,
            storedMimeType: $storedMimeType,
            storedSizeBytes: strlen($bytes),
            width: $width,
            height: $height,
            sha256: hash('sha256', $bytes),
        );
    }

    public function commit(PreparedAttendanceEvidence $evidence): void
    {
        $disk = Storage::disk(self::DISK);

        if ($disk->exists($evidence->storagePath)) {
            return;
        }

        if (! $disk->exists($evidence->temporaryPath) || ! $disk->move($evidence->temporaryPath, $evidence->storagePath)) {
            throw new RuntimeException('Could not commit private attendance evidence.');
        }
    }

    public function cleanup(PreparedAttendanceEvidence $evidence): void
    {
        $disk = Storage::disk(self::DISK);
        $disk->delete($evidence->temporaryPath);

        try {
            $referenced = AttendanceEvidence::query()->where('storage_path', $evidence->storagePath)->exists();
        } catch (\Throwable) {
            return;
        }

        if (! $referenced) {
            $disk->delete($evidence->storagePath);
        }
    }

    public function stream(string $storagePath): ?string
    {
        $disk = Storage::disk(self::DISK);

        return $disk->exists($storagePath) ? $disk->path($storagePath) : null;
    }

    public function webpEncodingAvailable(): bool
    {
        $gdInfo = function_exists('gd_info') ? gd_info() : [];

        return function_exists('imagewebp') && (bool) ($gdInfo['WebP Support'] ?? false);
    }

    private function applyJpegOrientation(\GdImage $image, string $path): \GdImage
    {
        if (! function_exists('exif_read_data')) {
            imagedestroy($image);
            throw new RuntimeException('EXIF support is required to normalize attendance photo orientation.');
        }

        $exif = $path !== '' ? @exif_read_data($path, 'IFD0', true, false) : false;
        $orientation = (int) ($exif['IFD0']['Orientation'] ?? $exif['Orientation'] ?? 1);
        $rotation = match ($orientation) {
            3 => 180,
            5, 6 => -90,
            7, 8 => 90,
            default => 0,
        };

        if ($rotation !== 0) {
            $rotated = imagerotate($image, $rotation, 0);
            if (! $rotated instanceof \GdImage) {
                imagedestroy($image);
                throw new RuntimeException('Could not normalize attendance photo orientation.');
            }
            imagedestroy($image);
            $image = $rotated;
        }

        $flip = match ($orientation) {
            2, 5 => IMG_FLIP_HORIZONTAL,
            4 => IMG_FLIP_VERTICAL,
            7 => IMG_FLIP_HORIZONTAL,
            default => null,
        };

        if ($flip !== null && ! imageflip($image, $flip)) {
            imagedestroy($image);
            throw new RuntimeException('Could not normalize attendance photo orientation.');
        }

        return $image;
    }

    private function cleanStaleStagingFiles(): void
    {
        $disk = Storage::disk(self::DISK);
        $cutoff = now()->subHour()->getTimestamp();

        foreach ($disk->files('attendance-evidence/.staging') as $path) {
            try {
                if ($disk->lastModified($path) < $cutoff) {
                    $disk->delete($path);
                }
            } catch (\Throwable) {
                // A cleanup failure must not prevent a new valid attendance attempt.
            }
        }
    }
}
