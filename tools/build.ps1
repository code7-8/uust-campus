param([string]$Sdk = $env:ANDROID_HOME, [string]$Jdk = $env:JAVA_HOME, [switch]$SideBySide)
$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Project
if (-not $Sdk) { $Sdk = 'F:\void_oneplus\.tools\android-sdk' }
if (-not $Jdk) { $Jdk = 'F:\void_oneplus\.tools\jdk\jdk-21.0.12.1+1' }
if (-not (Test-Path -LiteralPath "$Sdk\platforms\android-35\android.jar")) { throw 'Set ANDROID_HOME to an Android SDK with platform 35 and build-tools 35.0.0.' }
if (-not (Test-Path -LiteralPath "$Jdk\bin\javac.exe")) { throw 'Set JAVA_HOME to a JDK 17 or 21.' }
$Bt = Join-Path $Sdk 'build-tools\35.0.0'
$Jar = Join-Path $Sdk 'platforms\android-35\android.jar'
$Stage = Join-Path ([IO.Path]::GetTempPath()) ('uust-campus-build-' + [guid]::NewGuid().ToString('N'))
$Build = Join-Path $Stage 'build'
$env:JAVA_HOME = $Jdk
New-Item -ItemType Directory -Force -Path "$Build\classes","$Build\dex","$Project\artifacts","$Project\tools\signing" | Out-Null
Copy-Item -LiteralPath "$Project\android" -Destination "$Stage\android" -Recurse
Copy-Item -LiteralPath "$Project\app" -Destination "$Stage\app" -Recurse
if ($SideBySide) {
  # Keep the Java class package; only the install identity and launcher aliases change.
  $ManifestPath = Join-Path $Stage 'android\AndroidManifest.xml'
  $ManifestText = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
  $ManifestText = $ManifestText.Replace('package="ru.uust.campus"', 'package="ru.uust.campus.preview"')
  $ManifestText = $ManifestText.Replace('android:name=".MainActivity"', 'android:name="ru.uust.campus.MainActivity"')
  $ManifestText = $ManifestText.Replace('android:targetActivity=".MainActivity"', 'android:targetActivity="ru.uust.campus.MainActivity"')
  $ManifestText = $ManifestText -replace '(android:label="[^"]+)(")', '$1 0.3.0$2'
  [IO.File]::WriteAllText($ManifestPath, $ManifestText, [Text.UTF8Encoding]::new($false))
}
# Android's Windows aapt2 cannot reliably read Cyrillic paths. Stage only this
# project's source in an ASCII temporary directory; keep the deliverables here.
function Check { if ($LASTEXITCODE -ne 0) { throw "Build command failed: $LASTEXITCODE" } }
& "$Bt\aapt2.exe" compile --dir "$Stage\android\res" -o "$Build\resources.zip"
Check
& "$Bt\aapt2.exe" link -o "$Build\base.apk" --manifest "$Stage\android\AndroidManifest.xml" -I $Jar "$Build\resources.zip" --auto-add-overlay
Check
$Sources = @(Get-ChildItem -LiteralPath "$Stage\android\src" -Filter '*.java' -Recurse | ForEach-Object FullName)
& "$Jdk\bin\javac.exe" -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$Bt\core-lambda-stubs.jar;$Jar" -d "$Build\classes" $Sources
Check
& "$Jdk\bin\jar.exe" cf "$Build\classes.jar" -C "$Build\classes" .
Check
& "$Jdk\bin\java.exe" -cp "$Bt\lib\d8.jar" com.android.tools.r8.D8 --lib $Jar --min-api 26 --output "$Build\dex" "$Build\classes.jar"
Check
python "$Project\tools\package_apk.py" "$Build\base.apk" "$Stage\app" "$Build\dex\classes.dex" "$Build\unsigned.apk"
Check
& "$Bt\zipalign.exe" -f -p 4 "$Build\unsigned.apk" "$Build\aligned.apk"
Check
$Key = "$Project\tools\signing\campus-demo.jks"
if (-not (Test-Path -LiteralPath $Key)) {
  & "$Jdk\bin\keytool.exe" -genkeypair -keystore $Key -storepass android -keypass android -alias campus -dname 'CN=UUST Campus Hackathon' -keyalg RSA -keysize 2048 -validity 10000
  Check
}
$Apk = "$Project\artifacts\uust-campus-0.3.0.apk"
if ($SideBySide) { $Apk = "$Project\artifacts\uust-campus-0.3.0-parallel.apk" }
& "$Jdk\bin\java.exe" -jar "$Bt\lib\apksigner.jar" sign --ks $Key --ks-key-alias campus --ks-pass pass:android --key-pass pass:android --out "$Build\campus.apk" "$Build\aligned.apk"
Check
Copy-Item -LiteralPath "$Build\campus.apk" -Destination $Apk -Force
& "$Jdk\bin\java.exe" -jar "$Bt\lib\apksigner.jar" verify --verbose $Apk
Check
Get-FileHash -LiteralPath $Apk -Algorithm SHA256 | Format-List
Write-Output "APK ready: $Apk"
# Remove only the unique staging directory created above, after checking its root.
$ResolvedStage = [IO.Path]::GetFullPath($Stage)
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if ($ResolvedStage.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $ResolvedStage) -like 'uust-campus-build-*') {
  Remove-Item -LiteralPath $ResolvedStage -Recurse -Force
}
