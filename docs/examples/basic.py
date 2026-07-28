import os
from jokelboard import JokelboardClient, RevisionConflictError

BOARD_ID = "board-abc123"

with JokelboardClient(token=os.environ["JOKELBOARD_TOKEN"]) as client:
    boards = client.list_boards()
    print([b["name"] for b in boards])

    board = client.get_board(BOARD_ID)
    first_list = board["data"]["lists"][0]

    card = client.create_card(
        BOARD_ID,
        first_list["id"],
        "Fix login redirect",
        category_id="P1",
        labels=[{"name": "bug", "color": "#ff5e5e"}],
    )

    print(f"Created card: {card['ticket']} ({card['id']})")

    client.update_card(BOARD_ID, card["id"], {
        "fieldValues": {"discord-id": "1234567890"},
    })

    client.add_comment(BOARD_ID, card["id"], "Assigned to the platform team.")

    link = client.get_card_link(BOARD_ID, card["id"])
    print(f"Card URL: {link['url']}")

    # Move card to Done list
    done_list = next((l for l in board["data"]["lists"] if l["title"] == "Done"), None)
    if done_list:
        client.move_card(BOARD_ID, card["id"], done_list["id"])

    # Vault and restore
    client.vault_card(BOARD_ID, card["id"])
    client.restore_card(BOARD_ID, card["id"], to_list_id=first_list["id"])

    # Handle revision conflicts
    try:
        client.update_card(BOARD_ID, card["id"], {"title": "Updated title", "revision": 0})
    except RevisionConflictError as e:
        fresh = client.get_board(BOARD_ID)
        client.update_card(BOARD_ID, card["id"], {
            "title": "Updated title",
            "revision": fresh["revision"],
        })

    # Plugin API
    plugin_board = client.plugin.get_board(BOARD_ID)
    first_card = plugin_board["lists"][0]["cards"][0] if plugin_board["lists"] else None
    if first_card and first_card.get("checklist", {}).get("items"):
        item = first_card["checklist"]["items"][0]
        client.plugin.toggle_checklist_item(BOARD_ID, first_card["id"], item["id"])
