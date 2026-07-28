import { JokelboardClient, RevisionConflictError } from '@jokelboard/js';

const client = new JokelboardClient({ token: process.env.JOKELBOARD_TOKEN });

const BOARD_ID = 'board-abc123';

const boards = await client.listBoards();
console.log(boards.map(b => b.name));

const board = await client.getBoard(BOARD_ID);
const firstList = board.data.lists[0];

const card = await client.createCard(BOARD_ID, firstList.id, 'Fix login redirect', {
  categoryId: 'P1',
  labels: [{ name: 'bug', color: '#ff5e5e' }],
});

await client.updateCard(BOARD_ID, card.id, {
  fieldValues: { 'discord-id': '1234567890' },
});

await client.addComment(BOARD_ID, card.id, 'Assigned to the platform team.');

const link = await client.getCardLink(BOARD_ID, card.id);
console.log(`Card URL: ${link.url}`);
