package com.slax.reader.auth.fixture;

import java.lang.reflect.InvocationTargetException;
import java.util.List;

/** Inspects the real request builder on a controlled Android runtime without requesting credentials. */
public final class NativeGoogleOptionsProbe {
  public static void main(String[] args) throws Exception {
    if (args.length != 0) throw new IllegalArgumentException("This probe takes no operator configuration");
    Class<?> helperClass = Class.forName("com.slax.reader.platform.SlaxGoogleSignIn");
    Object helper = helperClass.getField("INSTANCE").get(null);
    String clientId = "slax-controlled-native-options.apps.googleusercontent.com";
    Object request = helperClass.getMethod("request", String.class).invoke(helper, clientId);
    List<?> options = (List<?>) request.getClass().getMethod("getCredentialOptions").invoke(request);
    require(options.size() == 1, "Expected one credential option");
    Object option = options.get(0);
    require(option.getClass().getName().equals("com.google.android.libraries.identity.googleid.GetGoogleIdOption"), "Expected the original Google ID option");
    require(Boolean.FALSE.equals(option.getClass().getMethod("getFilterByAuthorizedAccounts").invoke(option)), "Authorized-account filtering must be disabled");
    require(Boolean.TRUE.equals(option.getClass().getMethod("getAutoSelectEnabled").invoke(option)), "Automatic selection must be enabled");
    require(clientId.equals(option.getClass().getMethod("getServerClientId").invoke(option)), "Server client ID changed");
    for (String missing : new String[]{"", "   "}) {
      try {
        helperClass.getMethod("request", String.class).invoke(helper, missing);
        throw new AssertionError("Missing client ID was accepted");
      } catch (InvocationTargetException error) {
        require(error.getCause() instanceof IllegalArgumentException, "Missing client ID failed for an unexpected reason");
      }
    }
    System.out.println("{\"kind\":\"slax-controlled-native-google-options\",\"filterByAuthorizedAccounts\":false,\"autoSelectEnabled\":true,\"credentialOptions\":1,\"missingClientIdsRejected\":2,\"credentialRequestExecuted\":false,\"accountInteraction\":false}");
  }

  private static void require(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
}
