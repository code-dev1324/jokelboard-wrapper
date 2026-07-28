import { JokelboardClient, RevisionConflictError } from '@jokelboard/typescript';

const client = new JokelboardClient({ token: process.env.JOKELBOARD_TOKEN! });

const BOARD_ID = 'board-abc123';

// List all boards
const boards = await client.listBoards();
console.log(boards.map(b => b.name));

// Fetch a board
const board = await client.getBoard(BOARD_ID);
const firstList = board.data.lists[0];

// Create a card
const card = await client.createCard(BOARD_ID, firstList.id, 'Fix login redirect', {
  categoryId: 'P1',
  description: 'Users on mobile are sent to the wrong domain.',
  labels: [{ name: 'bug', color: '#ff5e5e' }],
});

console.log(`Created card: ${card.ticket} (${card.id})`);

// Set custom field values
await client.updateCard(BOARD_ID, card.id, {
  fieldValues: { 'owner-team': 'platform', 'discord-id': '1234567890' },
});

// Add a comment
await client.addComment(BOARD_ID, card.id, 'Assigned to the platform team.');

// Move to another list
const doneList = board.data.lists.find(l => l.title === 'Done');
if (doneList) {
  await client.moveCard(BOARD_ID, card.id, doneList.id);
}

// Get the shareable link
const link = await client.getCardLink(BOARD_ID, card.id);
console.log(`Card URL: ${link.url}`);

// Vault (soft-delete) and restore
await client.vaultCard(BOARD_ID, card.id);
await client.restoreCard(BOARD_ID, card.id, { toListId: firstList.id });

// Handle revision conflicts
try {
  await client.updateCard(BOARD_ID, card.id, { title: 'Updated title', revision: 0 });
} catch (err) {
  if (err instanceof RevisionConflictError) {
    const fresh = await client.getBoard(BOARD_ID);
    await client.updateCard(BOARD_ID, card.id, {
      title: 'Updated title',
      revision: fresh.revision,
    });
  }
}

// Plugin API
const pluginBoard = await client.plugin.getBoard(BOARD_ID);
const firstCard = pluginBoard.lists[0]?.cards[0];
const firstItem = firstCard?.checklist?.items[0];
if (firstItem?.id) {
  await client.plugin.toggleChecklistItem(BOARD_ID, firstCard.id, firstItem.id);
}
