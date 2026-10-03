package smoke;

import java.net.InetAddress;
import java.net.UnknownHostException;
import org.junit.jupiter.api.Test;

/** Informational: records whether name resolution works under the deny-all policy. */
class DnsLookupTest {
    @Test
    void reportsDnsBehaviour() {
        try {
            InetAddress.getByName("example.com");
            System.out.println("dns=resolved");
        } catch (UnknownHostException e) {
            System.out.println("dns=blocked");
        }
    }
}
