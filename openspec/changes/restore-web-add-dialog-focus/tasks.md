## 1. Implement the reviewed behavior

- [x] 1.1 Capture the invoking element at open time and focus it when the closing transition completes.
- [x] 1.2 If a successful submission intentionally navigates away, honor the destination's normal focus management. Support each existing dismiss action.

## 2. Verify the user journey

- [x] 2.1 Exercise **Keyboard dismissal**. When a reader activates Add with Enter and presses Escape in the URL input, verify that focus returns to the same Add button and Enter immediately reopens it.
- [x] 2.2 Exercise **Alternate opener**. When the dialog is opened from another available launch control and cancelled using its close button, verify that focus returns to that opener and the next Tab follows the surrounding order.
- [x] 2.3 Exercise **Route change**. When submission navigates to another view before dismissal finishes, verify that focus stays in the destination rather than moving to a detached opener.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
