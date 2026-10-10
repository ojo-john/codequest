package problems;

/** How to address a user. */
public final class Greeting {
    private Greeting() {
    }

    /** The nickname if the user set a real one, otherwise their full name. */
    public static String displayName(String nickname, String fullName) {
        return nickname.isBlank() ? fullName : nickname.trim();
    }
}
