package problems;

/** Disjoint sets over 0 … n − 1 with union by size and path compression. */
public final class UnionFind {
    private final int[] parent;
    private final int[] size;
    private int components;

    public UnionFind(int n) {
        if (n < 0) {
            throw new IllegalArgumentException("n must not be negative");
        }
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1;
        }
        components = n;
    }

    public boolean union(int a, int b) {
        int rootA = find(a);
        int rootB = find(b);
        if (rootA == rootB) {
            return false;
        }
        if (size[rootA] < size[rootB]) {
            int swap = rootA;
            rootA = rootB;
            rootB = swap;
        }
        parent[rootB] = rootA;
        size[rootA] += size[rootB];
        components--;
        return true;
    }

    public boolean connected(int a, int b) {
        return find(a) == find(b);
    }

    public int components() {
        return components;
    }

    private int find(int x) {
        if (x < 0 || x >= parent.length) {
            throw new IllegalArgumentException("no such element: " + x);
        }
        int root = x;
        while (parent[root] != root) {
            root = parent[root];
        }
        while (parent[x] != root) {
            int next = parent[x];
            parent[x] = root;
            x = next;
        }
        return root;
    }
}
