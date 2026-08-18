# Receipt fixtures

Real receipt photographs used to calibrate and regression-test the receipt
parser. **The images themselves are deliberately untracked** — see the
`/test-fixtures/receipts/*` rule in `.gitignore`.

## Why they are not committed

These are photographs of a real person's receipts. They carry purchase
histories, timestamps, store locations and partially-masked card numbers.
Keeping them out of git means they cannot reach a clone, a public artefact,
or a deployment: Vercel builds from the git tree, so an untracked file is
never uploaded and can never end up in the client bundle.

Nothing under `src/` imports this folder, and the images are not in `public/`,
so they are outside the bundle by construction as well.

## Working with them

Drop the `.jpg` files into this folder locally before running any calibration
or parser test that needs them. Tests that depend on these images must skip —
not fail — when the folder is empty, so a fresh clone stays green.
