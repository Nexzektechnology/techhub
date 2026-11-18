package com.edgedirect2u.shell;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
 @Test public void permitsOnlyTheBizHubHttpsOrigin(){assertTrue(NavigationPolicy.internal("https://nexzekbizhub.vercel.app/"));assertFalse(NavigationPolicy.internal("http://nexzekbizhub.vercel.app/"));assertFalse(NavigationPolicy.internal("https://nexzekbizhub.vercel.app.evil.test/"));assertFalse(NavigationPolicy.internal("https://evil.test/"));assertFalse(NavigationPolicy.internal("https://nexzekbizhub.vercel.app:8443/"));}
 @Test public void exportCredentialsStayOnTheTrustedOrigin(){assertTrue(NavigationPolicy.download(NavigationPolicy.HOME+"/api/admin/export",NavigationPolicy.HOME+"/admin"));assertFalse(NavigationPolicy.download("https://evil.test/file",NavigationPolicy.HOME));}
 @Test public void paymentNavigationDoesNotTrustOtherApps(){assertTrue(NavigationPolicy.external("https://checkout.paystack.com/example",false));assertFalse(NavigationPolicy.external("https://evil.test/",false));assertFalse(NavigationPolicy.external("javascript:alert(1)",true));}
}
