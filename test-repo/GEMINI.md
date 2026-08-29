# Artisan Oven Project Instructions

You are an AI coding agent responsible for implementing requested changes to this repository.

## Before making changes

1. Read and understand the GitHub Issue completely.
2. Inspect the existing repository and code before modifying anything.
3. Identify all files and systems that may be affected.
4. Understand how the existing implementation works before changing it.
5. Do not remove or break existing functionality.
6. Keep the existing design and styling unless the Issue specifically requests changes.
7. Never expose API keys, passwords, tokens, credentials, or other secrets.
8. Reuse the existing architecture and code patterns where possible.
9. Do not make assumptions when the existing code can be inspected to determine the correct approach.

## Implementing an Issue

When a GitHub Issue requests a feature, bug fix, improvement, or other code change:

1. Analyse the requested change.
2. Inspect all relevant files.
3. Determine the best implementation using the existing architecture.
4. Create a dedicated feature branch for the Issue.
5. Implement the requested change.
6. Make all necessary code/configuration changes.
7. Do not modify unrelated files.
8. Preserve existing functionality unless the Issue explicitly requires changing it.
9. Check the implementation for errors.
10. Run the appropriate tests, validation, or build commands available in the repository.
11. Fix any problems discovered during testing.
12. Review the final changes before creating the Pull Request.

## Git workflow

The automated workflow must follow this process:

GitHub Issue
→ inspect repository
→ create feature branch
→ implement changes
→ test/build
→ commit changes
→ push feature branch
→ create Pull Request targeting main

### Important Git rules

- NEVER push changes directly to `main`.
- NEVER commit changes directly to `main`.
- ALWAYS create a separate branch for each Issue.
- Use a clear branch name related to the Issue.
- Make focused commits.
- Push the completed branch.
- Create a Pull Request targeting `main`.
- NEVER merge the Pull Request.
- NEVER bypass the Pull Request review process.
- The repository owner must review and merge the Pull Request.

## Pull Request requirements

When creating the Pull Request:

1. Clearly explain what was changed.
2. Explain why the change was made.
3. List the important files/components that were changed.
4. Explain the tests/build checks that were performed.
5. Mention any limitations, assumptions, or things that require human review.
6. Reference the original GitHub Issue when appropriate.

The Pull Request should be ready for a human to review.

## If the Issue is unclear

If the requested change is ambiguous:

1. Inspect the repository for context first.
2. Do not invent requirements.
3. Make the safest reasonable interpretation if the intended behaviour is clear.
4. If the change cannot be implemented safely, do not make risky changes.
5. Explain the problem clearly in the Pull Request or Issue comment.

## Project-specific rules

Artisan Oven is a website that includes:

- Ordering
- Payments
- Customer information
- An admin area
- Google Forms
- Google Sheets
- Google Apps Script
- Email functionality
- GitHub Pages deployment

Be especially careful when modifying:

- Payment functionality
- Order processing
- Customer data
- Authentication
- Admin functionality
- Google Sheets integrations
- Google Apps Script
- Email systems
- API integrations

Never expose secrets or credentials.

Do not commit `.env` files, API keys, private keys, passwords, tokens, or other credentials.

## Deployment

The AI must NOT deploy directly to production or merge its own Pull Request.

The deployment process is:

Pull Request created
→ human review
→ Pull Request merged into main
→ GitHub Actions deploys the website
→ GitHub Actions deploys/update Apps Script where applicable

The human approval and merge step must remain in place.

## Final behaviour

When an Issue is automatically assigned to you by the GitHub Actions workflow, do not simply provide a proposed solution.

You are expected to:

1. Understand the Issue.
2. Inspect the repository.
3. Implement the solution.
4. Test the solution.
5. Create a feature branch.
6. Commit the changes.
7. Push the branch.
8. Create the Pull Request.
9. Stop and wait for human review.

Do not merge the Pull Request yourself.
