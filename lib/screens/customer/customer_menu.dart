import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../models/cart_model.dart';
import '../../services/menu_service.dart';

class CustomerMenuScreen extends StatelessWidget {
  const CustomerMenuScreen({super.key, required this.cart});

  final CartModel cart;

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
        final visible = docs.where((doc) => doc.data()['enabled'] == true).toList();

        if (visible.isEmpty) {
          return const Center(child: Text('No items available'));
        }

        return AnimatedBuilder(
          animation: cart,
          builder: (context, _) => ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: visible.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final doc = visible[index];
              final data = doc.data();
              final name = data['name'] ?? '';
              final price = data['price'] ?? 0;
              final description = data['description'] ?? '';
              final available = data['quantity'] ?? 0;

              final count = cart.quantityFor(doc.id);
              final soldOut = available <= 0;
              final canAdd = !soldOut && count < available;

              return Card(
                child: ListTile(
                  title: Text(name),
                  subtitle: Text('INR $price\n$description'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        onPressed: count > 0 ? () => cart.decrement(doc.id) : null,
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                      Text('$count'),
                      IconButton(
                        onPressed: canAdd
                            ? () => cart.addItem(
                                  id: doc.id,
                                  name: name,
                                  price: price,
                                  maxQuantity: available,
                                )
                            : null,
                        icon: const Icon(Icons.add_circle_outline),
                      ),
                    ],
                  ),
                  enabled: !soldOut,
                ),
              );
            },
          ),
        );
      },
    );
  }
}
