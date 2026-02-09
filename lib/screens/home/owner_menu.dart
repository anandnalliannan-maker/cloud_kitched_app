import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/menu_service.dart';
import 'menu_form_screen.dart';

class OwnerMenuScreen extends StatelessWidget {
  const OwnerMenuScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final menuService = MenuService();

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: menuService.watchMenu(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final docs = snapshot.data?.docs ?? [];

        return Scaffold(
          body: docs.isEmpty
              ? const Center(child: Text('No menu items yet'))
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: docs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final doc = docs[index];
                    final data = doc.data();
                    final name = data['name'] ?? '';
                    final price = data['price'] ?? 0;
                    final quantity = data['quantity'] ?? 0;
                    final enabled = data['enabled'] == true;

                    return Card(
                      child: ListTile(
                        title: Text(name),
                        subtitle: Text('INR $price | Qty: $quantity'),
                        trailing: Switch(
                          value: enabled,
                          onChanged: (value) =>
                              menuService.toggleEnabled(doc.id, value),
                        ),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => MenuFormScreen(
                                initialName: name,
                                initialDescription: data['description'] ?? '',
                                initialQuantity: quantity,
                                initialPrice: price,
                                initialEnabled: enabled,
                                onSubmit: ({
                                  required String name,
                                  required String description,
                                  required int quantity,
                                  required int price,
                                  required bool enabled,
                                }) {
                                  return menuService.updateMenuItem(
                                    doc.id,
                                    name: name,
                                    description: description,
                                    quantity: quantity,
                                    price: price,
                                    enabled: enabled,
                                  );
                                },
                              ),
                            ),
                          );
                        },
                      ),
                    );
                  },
                ),
          floatingActionButton: FloatingActionButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => MenuFormScreen(
                    onSubmit: ({
                      required String name,
                      required String description,
                      required int quantity,
                      required int price,
                      required bool enabled,
                    }) {
                      return menuService.addMenuItem(
                        name: name,
                        description: description,
                        quantity: quantity,
                        price: price,
                        enabled: enabled,
                      );
                    },
                  ),
                ),
              );
            },
            child: const Icon(Icons.add),
          ),
        );
      },
    );
  }
}
