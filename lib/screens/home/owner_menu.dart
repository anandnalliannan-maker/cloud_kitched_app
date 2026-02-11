import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/menu_service.dart';
import 'menu_form_screen.dart';
import 'publish_menu_screen.dart';

class OwnerMenuScreen extends StatefulWidget {
  const OwnerMenuScreen({super.key});

  @override
  State<OwnerMenuScreen> createState() => _OwnerMenuScreenState();
}

class _OwnerMenuScreenState extends State<OwnerMenuScreen> {
  final _menuService = MenuService();
  final Set<String> _selected = {};
  String _query = '';

  Future<void> _openPublishPage(List<QueryDocumentSnapshot<Map<String, dynamic>>> items) async {
    if (_selected.isEmpty) return;

    final selectedItems = items.where((doc) => _selected.contains(doc.id)).toList();
    final payload = selectedItems.map((doc) {
      final data = doc.data();
      return {
        'id': doc.id,
        'name': data['name'] ?? '',
        'price': data['price'] ?? 0,
        'description': data['description'] ?? '',
      };
    }).toList();

    final published = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => PublishMenuScreen(items: payload),
      ),
    );

    if (published == true && mounted) {
      setState(() => _selected.clear());
    }
  }

  void _toggleSelected(String id) {
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
      } else {
        _selected.add(id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _menuService.watchMenu(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final docs = snapshot.data?.docs ?? [];
        final filtered = docs.where((doc) {
          if (_query.isEmpty) return true;
          final name = (doc.data()['name'] ?? '').toString().toLowerCase();
          return name.contains(_query);
        }).toList();

        if (filtered.isEmpty) {
          return const Center(child: Text('No menu items yet'));
        }

        return Scaffold(
          body: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: TextField(
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Search menu items',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) => setState(() => _query = value.toLowerCase()),
                ),
              ),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final doc = filtered[index];
                    final data = doc.data();
                    final name = data['name'] ?? '';
                    final price = data['price'] ?? 0;
                    final description = data['description'] ?? '';
                    final checked = _selected.contains(doc.id);

                    return Card(
                      child: ListTile(
                        title: Text(name),
                        subtitle: Text('INR $price\n$description'),
                        leading: Checkbox(
                          value: checked,
                          onChanged: (_) => _toggleSelected(doc.id),
                        ),
                        trailing: PopupMenuButton<String>(
                          onSelected: (value) {
                            if (value == 'edit') {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => MenuFormScreen(
                                    initialName: name,
                                    initialDescription: description,
                                    initialPrice: price,
                                    onSubmit: ({
                                      required String name,
                                      required String description,
                                      required int price,
                                    }) {
                                      return _menuService.updateMenuItem(
                                        doc.id,
                                        name: name,
                                        description: description,
                                        price: price,
                                      );
                                    },
                                  ),
                                ),
                              );
                            }
                            if (value == 'delete') {
                              _menuService.deleteMenuItem(doc.id);
                            }
                          },
                          itemBuilder: (_) => const [
                            PopupMenuItem(value: 'edit', child: Text('Edit')),
                            PopupMenuItem(value: 'delete', child: Text('Delete')),
                          ],
                        ),
                        onTap: () => _toggleSelected(doc.id),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => MenuFormScreen(
                    onSubmit: ({
                      required String name,
                      required String description,
                      required int price,
                    }) {
                      return _menuService.addMenuItem(
                        name: name,
                        description: description,
                        price: price,
                      );
                    },
                  ),
                ),
              );
            },
            child: const Icon(Icons.add),
          ),
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton(
                onPressed: _selected.isEmpty ? null : () => _openPublishPage(docs),
                child: Text('Checkout selected menu (${_selected.length})'),
              ),
            ),
          ),
        );
      },
    );
  }
}
