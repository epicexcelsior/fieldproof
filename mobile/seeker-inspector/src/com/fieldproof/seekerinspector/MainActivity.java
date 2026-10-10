package com.fieldproof.seekerinspector;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.SurfaceTexture;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.view.Surface;
import android.view.TextureView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.graphics.Color;
import android.graphics.Typeface;
import android.util.Size;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;

public final class MainActivity extends Activity implements TextureView.SurfaceTextureListener {
    private static final int CAMERA_PERMISSION = 701;
    private static final String KEY_ALIAS = "fieldproof-photo-v1";
    private static final String PROFILE = "fieldproof-photo-v1";
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextureView preview;
    private EditText jobInput, nonceInput, providerInput;
    private TextView status, keyText;
    private Button requestButton, captureButton;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private String cameraId;
    private boolean cameraOpening, previewReady, capturing;
    private long requestedAt, requestElapsed;
    private String requestedJob, requestedProvider;
    private int requestedNonce;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(18, 43, 57));
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(22, 22, 22, 22);
        panel.setBackgroundColor(Color.rgb(245, 247, 246));
        TextView title = label("FieldProof photo check", 25, true);
        panel.addView(title);
        panel.addView(label("Operator-assisted prototype. Capture starts only after a new request. No payment or peaq event occurs in this app.", 15, false));
        jobInput = field("Job ID, 16 lowercase hex characters", "");
        nonceInput = field("Positive challenge nonce", "");
        nonceInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        providerInput = field("Provider", "seeker-inspector-01");
        panel.addView(jobInput); panel.addView(nonceInput); panel.addView(providerInput);
        requestButton = button("Request fresh photo");
        captureButton = button("Capture requested photo");
        captureButton.setEnabled(false);
        panel.addView(requestButton); panel.addView(captureButton);
        preview = new TextureView(this);
        preview.setSurfaceTextureListener(this);
        LinearLayout.LayoutParams cameraParams = new LinearLayout.LayoutParams(-1, 560);
        cameraParams.topMargin = 20;
        panel.addView(preview, cameraParams);
        status = label("Enter a job ID and nonce, then request a fresh capture.", 15, false);
        panel.addView(status);
        keyText = label("Public key appears after the first capture. It must be pinned through a trusted channel.", 13, false);
        keyText.setTextIsSelectable(true);
        panel.addView(keyText);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(panel);
        setContentView(scroll);
        requestButton.setOnClickListener(v -> requestPhoto());
        captureButton.setOnClickListener(v -> capturePhoto());
    }

    private TextView label(String value, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(Color.rgb(18, 43, 57));
        view.setPadding(0, 10, 0, 10);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        return view;
    }
    private EditText field(String hint, String value) {
        EditText view = new EditText(this);
        view.setHint(hint); view.setText(value); view.setSingleLine(true);
        return view;
    }
    private Button button(String value) { Button view = new Button(this); view.setText(value); return view; }
    private void say(String value) { status.setText(value); }

    private void requestPhoto() {
        if (capturing) { say("The current camera capture is still in progress. Wait before another request."); return; }
        String job = jobInput.getText().toString().trim();
        String nonceText = nonceInput.getText().toString().trim();
        String provider = providerInput.getText().toString().trim();
        if (!job.matches("[0-9a-f]{16}") || !nonceText.matches("[1-9][0-9]{0,9}") ||
                !provider.matches("[A-Za-z0-9_-]{3,64}")) {
            say("Use a 16-character lowercase hex job ID, positive nonce, and simple provider ID.");
            return;
        }
        long nonce;
        try { nonce = Long.parseLong(nonceText); } catch (NumberFormatException error) { say("Nonce is outside its range."); return; }
        if (nonce > 0x7fffffffL) { say("Nonce must fit a positive 32-bit integer."); return; }
        requestedJob = job;
        requestedNonce = (int) nonce;
        requestedProvider = provider;
        requestedAt = System.currentTimeMillis() / 1000L;
        requestElapsed = SystemClock.elapsedRealtimeNanos();
        capturing = false;
        captureButton.setEnabled(previewReady);
        say("Fresh request recorded at Unix second " + requestedAt + ". Check the scene and select Capture requested photo.");
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            captureButton.setEnabled(false);
            requestPermissions(new String[]{ Manifest.permission.CAMERA }, CAMERA_PERMISSION);
        } else openCamera();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != CAMERA_PERMISSION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else say("Camera permission is required for a new photo. No capture occurred.");
    }

    @Override public void onResume() { super.onResume(); if (preview != null && preview.isAvailable()) openCamera(); }
    @Override public void onPause() { closeCamera(); super.onPause(); }
    @Override public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) { openCamera(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) { }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { closeCamera(); return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) { }

    private Size chooseSize(Size[] sizes) {
        Size best = null;
        for (Size size : sizes) {
            if (size.getWidth() <= 1920 && size.getHeight() <= 1080 &&
                    (best == null || (long)size.getWidth()*size.getHeight() > (long)best.getWidth()*best.getHeight())) best = size;
        }
        return best != null ? best : sizes[0];
    }

    private void openCamera() {
        if (camera != null || cameraOpening || preview == null || !preview.isAvailable() ||
                checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            String[] ids = manager.getCameraIdList();
            if (ids.length == 0) { say("No camera is available. No capture occurred."); return; }
            cameraId = ids[0];
            for (String id : ids) {
                Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) { cameraId = id; break; }
            }
            StreamConfigurationMap map = manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (map == null || map.getOutputSizes(ImageFormat.JPEG) == null ||
                    map.getOutputSizes(SurfaceTexture.class) == null) {
                say("This camera lacks the required JPEG or preview output. No capture occurred."); return;
            }
            Size jpeg = chooseSize(map.getOutputSizes(ImageFormat.JPEG));
            Size view = chooseSize(map.getOutputSizes(SurfaceTexture.class));
            preview.getSurfaceTexture().setDefaultBufferSize(view.getWidth(), view.getHeight());
            reader = ImageReader.newInstance(jpeg.getWidth(), jpeg.getHeight(), ImageFormat.JPEG, 2);
            reader.setOnImageAvailableListener(this::photoAvailable, main);
            cameraOpening = true;
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice opened) { cameraOpening = false; camera = opened; startPreview(); }
                @Override public void onDisconnected(CameraDevice opened) { opened.close(); camera = null; previewReady = false; captureButton.setEnabled(false); say("Camera disconnected. No capture occurred."); }
                @Override public void onError(CameraDevice opened, int error) { opened.close(); camera = null; cameraOpening = false; previewReady = false; captureButton.setEnabled(false); say("Camera error. Request a new capture after recovery."); }
            }, main);
        } catch (Exception error) { cameraOpening = false; say("Camera setup failed. No capture occurred: " + error.getClass().getSimpleName()); }
    }

    private void startPreview() {
        if (camera == null || reader == null || preview == null || !preview.isAvailable()) return;
        try {
            Surface surface = new Surface(preview.getSurfaceTexture());
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            request.addTarget(surface);
            camera.createCaptureSession(Arrays.asList(surface, reader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession configured) {
                    session = configured;
                    try { session.setRepeatingRequest(request.build(), null, main); previewReady = true;
                        captureButton.setEnabled(requestedJob != null && !capturing); }
                    catch (CameraAccessException error) { say("Preview failed. No capture occurred."); }
                }
                @Override public void onConfigureFailed(CameraCaptureSession failed) { say("Camera session failed. No capture occurred."); }
            }, main);
        } catch (CameraAccessException error) { say("Camera preview unavailable. No capture occurred."); }
    }

    private void capturePhoto() {
        if (!previewReady || session == null || camera == null || reader == null || requestedJob == null || capturing) return;
        if (SystemClock.elapsedRealtimeNanos() <= requestElapsed) { say("Capture must follow the request."); return; }
        capturing = true; captureButton.setEnabled(false);
        requestButton.setEnabled(false);
        try {
            CaptureRequest.Builder still = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            still.addTarget(reader.getSurface());
            still.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            session.capture(still.build(), new CameraCaptureSession.CaptureCallback() {
                @Override public void onCaptureFailed(CameraCaptureSession current, CaptureRequest request,
                        android.hardware.camera2.CaptureFailure failure) {
                    capturing = false; requestedJob = null; requestButton.setEnabled(true); say("Capture failed. Request a new photo.");
                }
            }, main);
        } catch (CameraAccessException error) { capturing = false; requestedJob = null; requestButton.setEnabled(true); say("Capture failed. Request a new photo."); }
    }

    private void photoAvailable(ImageReader source) {
        Image image = null;
        try {
            image = source.acquireNextImage();
            if (image == null || !capturing || requestedJob == null) return;
            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] jpeg = new byte[buffer.remaining()]; buffer.get(jpeg);
            long capturedAt = System.currentTimeMillis() / 1000L;
            if (jpeg.length < 100 || SystemClock.elapsedRealtimeNanos() <= requestElapsed || capturedAt < requestedAt) {
                throw new IllegalStateException("Capture time or JPEG bytes are invalid");
            }
            saveEvidence(jpeg, capturedAt);
            requestedJob = null;
            say("Photo and signed envelope saved in app storage. Export with debug run-as after you review the image.");
        } catch (Exception error) {
            requestedJob = null;
            say("Photo evidence failed. Request a new photo: " + error.getClass().getSimpleName());
        } finally {
            if (image != null) image.close();
            capturing = false; captureButton.setEnabled(false);
            requestButton.setEnabled(true);
        }
    }

    private KeyPair keyPair() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return new KeyPair(store.getCertificate(KEY_ALIAS).getPublicKey(),
            (java.security.PrivateKey) store.getKey(KEY_ALIAS, null));
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256).build());
        return generator.generateKeyPair();
    }

    private static String hex(byte[] value) {
        StringBuilder out = new StringBuilder(value.length * 2);
        for (byte b : value) out.append(String.format(java.util.Locale.US, "%02x", b & 0xff));
        return out.toString();
    }
    private static byte[] fixed(BigInteger coordinate) {
        byte[] raw = coordinate.toByteArray(), out = new byte[32];
        if (raw.length > 33 || (raw.length == 33 && raw[0] != 0)) throw new IllegalArgumentException("Invalid P-256 coordinate");
        System.arraycopy(raw, Math.max(0, raw.length - 32), out, Math.max(0, 32 - raw.length), Math.min(32, raw.length));
        return out;
    }
    private static String publicSec1(ECPublicKey key) {
        byte[] encoded = new byte[65]; encoded[0] = 4;
        System.arraycopy(fixed(key.getW().getAffineX()), 0, encoded, 1, 32);
        System.arraycopy(fixed(key.getW().getAffineY()), 0, encoded, 33, 32);
        return hex(encoded);
    }
    private static String securityLevel(KeyPair pair) {
        if (Build.VERSION.SDK_INT < 31) return "not_reported_api_below_31";
        try {
            KeyFactory factory = KeyFactory.getInstance("EC", "AndroidKeyStore");
            KeyInfo info = factory.getKeySpec(pair.getPrivate(), KeyInfo.class);
            switch (info.getSecurityLevel()) {
                case KeyProperties.SECURITY_LEVEL_STRONGBOX: return "strongbox_reported";
                case KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT: return "trusted_environment_reported";
                case KeyProperties.SECURITY_LEVEL_SOFTWARE: return "software_reported";
                default: return "unknown_reported";
            }
        } catch (Exception error) { return "unavailable"; }
    }

    private void saveEvidence(byte[] jpeg, long capturedAt) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(jpeg);
        String imageHash = hex(digest);
        String message = PROFILE + "|" + requestedJob + "|" + requestedProvider + "|" + requestedNonce + "|" +
            imageHash + "|" + requestedAt + "|" + capturedAt;
        KeyPair key = keyPair();
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(key.getPrivate()); signer.update(message.getBytes(StandardCharsets.UTF_8));
        byte[] signature = signer.sign(); // DER encoding. The verifier requires canonical DER.
        String name = requestedJob + "-" + capturedAt + "-" + Long.toHexString(SystemClock.elapsedRealtimeNanos());
        File directory = new File(getFilesDir(), "jobs");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Cannot create private job directory");
        File photo = new File(directory, name + ".jpg"), envelope = new File(directory, name + ".json");
        JSONObject json = new JSONObject();
        json.put("schema", PROFILE); json.put("job_id", requestedJob); json.put("provider", requestedProvider);
        json.put("nonce", requestedNonce); json.put("requested_at", requestedAt); json.put("captured_at", capturedAt);
        json.put("image_sha256", imageHash); json.put("image_file", photo.getName());
        json.put("public_key_sec1_hex", publicSec1((ECPublicKey) key.getPublic()));
        json.put("signature_algorithm", "ECDSA_P256_SHA256"); json.put("signature_encoding", "DER");
        json.put("signature_base64", android.util.Base64.encodeToString(signature, android.util.Base64.NO_WRAP));
        json.put("key_security_level", securityLevel(key));
        try {
            try (FileOutputStream stream = new FileOutputStream(photo)) { stream.write(jpeg); stream.getFD().sync(); }
            try (FileOutputStream stream = new FileOutputStream(envelope)) {
                stream.write((json.toString(2) + "\n").getBytes(StandardCharsets.UTF_8)); stream.getFD().sync();
            }
        } catch (Exception error) { photo.delete(); envelope.delete(); throw error; }
        keyText.setText("Public P-256 pin (not proof of camera origin): " + json.getString("public_key_sec1_hex") +
            "\nFiles: jobs/" + photo.getName() + " and jobs/" + envelope.getName());
    }

    private void closeCamera() {
        previewReady = false; capturing = false; requestedJob = null;
        captureButton.setEnabled(false); requestButton.setEnabled(true);
        if (session != null) { session.close(); session = null; }
        if (camera != null) { camera.close(); camera = null; }
        if (reader != null) { reader.close(); reader = null; }
        cameraOpening = false;
    }
}
