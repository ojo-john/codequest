# From memory: reverse a linked list

`ReverseList.Node` is a singly linked list node with `value` and `next`. Write
`ReverseList.reverse(Node head)`: reverse the list **in place** (re-point the `next` references;
create no new nodes and use no other collection) and return the new head. An empty list is
`null` and stays `null`.

`reversedValues` (already written) builds a list from an array, calls your method and reads the
result back; the checks use it. Aim for O(n) time and O(1) extra space.

**From memory.** No template, snippets or step-by-step hints here: write it the way you would on
a whiteboard, then run the samples. Library shortcuts that do the whole job (like `Arrays.sort`
or `Collections.reverse`) defeat the point, so don't use them.
