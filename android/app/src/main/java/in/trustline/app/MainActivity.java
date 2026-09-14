package in.trustline.app;

import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // This app is a single hash-routed page served from a remote URL, so the
    // WebView's own history is exactly the user's navigation: every screen was
    // reached by a normal forward link. Android's back gesture should therefore
    // walk that history back one screen, and only close the app when the user is
    // already on the front page with nowhere left to go.
    @Override
    public void onBackPressed() {
        WebView webView = getBridge().getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}