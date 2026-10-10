package problems;

/** Reversing a singly linked list in place. */
public final class ReverseList {
    private ReverseList() {
    }

    /** A list node. */
    public static final class Node {
        int value;
        Node next;

        Node(int value, Node next) {
            this.value = value;
            this.next = next;
        }
    }

    /** Reverses the list starting at head and returns the new head. */
    public static Node reverse(Node head) {
        Node previous = null;
        Node current = head;
        while (current != null) {
            Node following = current.next;
            current.next = previous;
            previous = current;
            current = following;
        }
        return previous;
    }

    /** Builds a list from values, reverses it, and reads it back (used by the checks). */
    public static int[] reversedValues(int[] values) {
        Node head = null;
        for (int i = values.length - 1; i >= 0; i--) {
            head = new Node(values[i], head);
        }
        Node reversed = reverse(head);
        int count = 0;
        for (Node node = reversed; node != null; node = node.next) {
            count++;
        }
        int[] result = new int[count];
        int i = 0;
        for (Node node = reversed; node != null; node = node.next) {
            result[i++] = node.value;
        }
        return result;
    }
}
