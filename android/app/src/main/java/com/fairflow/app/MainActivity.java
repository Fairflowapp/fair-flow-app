package com.fairflow.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugin BEFORE super.onCreate so the bridge picks it up.
        registerPlugin(FfFileSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
