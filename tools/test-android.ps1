param([string]$Serial='emulator-5554', [string]$Sdk=$env:ANDROID_HOME, [string]$Jdk=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
$Project=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Project
if(-not $Sdk){$Sdk='F:\void_oneplus\.tools\android-sdk'}
if(-not $Jdk){$Jdk='F:\void_oneplus\.tools\jdk\jdk-21.0.12.1+1'}
$Bt=Join-Path $Sdk 'build-tools\35.0.0'
$Jar=Join-Path $Sdk 'platforms\android-35\android.jar'
$Stage=Join-Path ([IO.Path]::GetTempPath()) ('campus-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path "$Stage\classes","$Stage\dex" | Out-Null
Copy-Item -LiteralPath "$Project\tests\android\AndroidManifest.xml" -Destination "$Stage\AndroidManifest.xml"
Copy-Item -LiteralPath "$Project\tests\android\CampusInstrumentation.java" -Destination "$Stage\CampusInstrumentation.java"
function Check {if($LASTEXITCODE -ne 0){throw "Android test command failed: $LASTEXITCODE"}}
& "$Bt\aapt2.exe" link -o "$Stage\test.apk" --manifest "$Stage\AndroidManifest.xml" -I $Jar
Check
& "$Jdk\bin\javac.exe" -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$Bt\core-lambda-stubs.jar;$Jar" -d "$Stage\classes" "$Stage\CampusInstrumentation.java"
Check
& "$Jdk\bin\jar.exe" cf "$Stage\classes.jar" -C "$Stage\classes" .
Check
& "$Jdk\bin\java.exe" -cp "$Bt\lib\d8.jar" com.android.tools.r8.D8 --lib $Jar --min-api 26 --output "$Stage\dex" "$Stage\classes.jar"
Check
& "$Jdk\bin\jar.exe" uf "$Stage\test.apk" -C "$Stage\dex" classes.dex
Check
& "$Bt\zipalign.exe" -f -p 4 "$Stage\test.apk" "$Stage\aligned.apk"
Check
& "$Jdk\bin\java.exe" -jar "$Bt\lib\apksigner.jar" sign --ks "$Project\tools\signing\campus-demo.jks" --ks-key-alias campus --ks-pass pass:android --key-pass pass:android --out "$Stage\signed.apk" "$Stage\aligned.apk"
Check
& "$Sdk\platform-tools\adb.exe" -s $Serial install -r "$Project\artifacts\uust-campus-0.1.0.apk"
Check
& "$Sdk\platform-tools\adb.exe" -s $Serial install -r "$Stage\signed.apk"
Check
& "$Sdk\platform-tools\adb.exe" -s $Serial shell am force-stop ru.uust.campus
$Result = & "$Sdk\platform-tools\adb.exe" -s $Serial shell am instrument -w ru.uust.campus.tests/ru.uust.campus.tests.CampusInstrumentation
$Result | Tee-Object -FilePath "$Project\artifacts\android-test-report.txt"
New-Item -ItemType Directory -Force -Path "$Project\artifacts\screenshots" | Out-Null
& "$Sdk\platform-tools\adb.exe" -s $Serial pull /sdcard/Android/data/ru.uust.campus/files/. "$Project\artifacts\screenshots"
if (($Result -join "`n") -notmatch 'PASSED \d+ checks') {throw 'Android instrumentation failed; see artifacts/android-test-report.txt'}
$TempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$Resolved=[IO.Path]::GetFullPath($Stage)
if($Resolved.StartsWith($TempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $Resolved) -like 'campus-test-*'){Remove-Item -LiteralPath $Resolved -Recurse -Force}
