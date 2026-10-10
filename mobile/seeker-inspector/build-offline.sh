#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_dir="$repo_root/mobile/seeker-inspector"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
android_jar="$sdk_root/platforms/android-35/android.jar"
build_tools="$sdk_root/build-tools/35.0.0"
output_dir="$repo_root/.local/competition/seeker-build"
scratch_dir="$(mktemp -d /tmp/fieldproof-seeker.XXXXXX)"
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$scratch_dir"' EXIT

for tool in javac keytool zip; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
for file in "$android_jar" "$build_tools/aapt2" "$build_tools/d8" "$build_tools/zipalign" "$build_tools/apksigner"; do
  test -f "$file" || { echo "Missing $file" >&2; exit 1; }
done
mkdir -p "$scratch_dir/classes" "$scratch_dir/dex" "$output_dir"
javac -source 8 -target 8 -Xlint:deprecation -cp "$android_jar" -d "$scratch_dir/classes" "$source_dir/src/com/fieldproof/seekerinspector/MainActivity.java"
"$build_tools/d8" --lib "$android_jar" --min-api 28 --output "$scratch_dir/dex" "$scratch_dir/classes/com/fieldproof/seekerinspector"/*.class
"$build_tools/aapt2" link -o "$scratch_dir/base.apk" --manifest "$source_dir/AndroidManifest.xml" -I "$android_jar" --min-sdk-version 28 --target-sdk-version 35
(cd "$scratch_dir/dex" && zip -q "$scratch_dir/base.apk" classes.dex)
"$build_tools/zipalign" -f 4 "$scratch_dir/base.apk" "$scratch_dir/aligned.apk"
if test ! -f "$output_dir/debug.keystore"; then
  keytool -genkeypair -keystore "$output_dir/debug.keystore" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 3650 \
    -dname "CN=FieldProof local debug,O=FieldProof,C=DE" -noprompt >/dev/null 2>&1
  chmod 600 "$output_dir/debug.keystore"
fi
"$build_tools/apksigner" sign --ks "$output_dir/debug.keystore" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android --out "$output_dir/seeker-inspector-debug.apk" "$scratch_dir/aligned.apk"
"$build_tools/apksigner" verify --verbose "$output_dir/seeker-inspector-debug.apk"
echo "$output_dir/seeker-inspector-debug.apk"
