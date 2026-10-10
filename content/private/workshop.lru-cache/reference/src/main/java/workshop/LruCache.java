package workshop;

import java.util.HashMap;
import java.util.Map;

/** A fixed-capacity cache that evicts the least recently used entry. */
public final class LruCache {
    private static final class Node {
        final String key;
        String value;
        Node previous;
        Node next;

        Node(String key, String value) {
            this.key = key;
            this.value = value;
        }
    }

    private final int capacity;
    private final Map<String, Node> index = new HashMap<>();
    /** Sentinels: head.next is the most recently used entry, tail.previous the least. */
    private final Node head = new Node(null, null);
    private final Node tail = new Node(null, null);

    public LruCache(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
        head.next = tail;
        tail.previous = head;
    }

    public String get(String key) {
        Node node = index.get(key);
        if (node == null) {
            return null;
        }
        unlink(node);
        pushFront(node);
        return node.value;
    }

    public void put(String key, String value) {
        Node node = index.get(key);
        if (node != null) {
            node.value = value;
            unlink(node);
            pushFront(node);
            return;
        }
        node = new Node(key, value);
        index.put(key, node);
        pushFront(node);
        if (index.size() > capacity) {
            Node eldest = tail.previous;
            unlink(eldest);
            index.remove(eldest.key);
        }
    }

    public int size() {
        return index.size();
    }

    private void unlink(Node node) {
        node.previous.next = node.next;
        node.next.previous = node.previous;
    }

    private void pushFront(Node node) {
        node.next = head.next;
        node.previous = head;
        head.next.previous = node;
        head.next = node;
    }
}
