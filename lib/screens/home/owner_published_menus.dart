import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';
import '../../services/published_menu_service.dart';

class OwnerPublishedMenusScreen extends StatelessWidget {
  const OwnerPublishedMenusScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final service = PublishedMenuService();

    return Scaffold(
      appBar: AppBar(title: const Text('Published Menus')),
      body: SafeArea(
        child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: service.watchPublishedMenus(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            final menus = (snapshot.data?.docs ?? []).toList()
              ..sort((a, b) {
                final aDate = (a.data()['date'] as Timestamp?)?.toDate();
                final bDate = (b.data()['date'] as Timestamp?)?.toDate();
                final dateCompare = (aDate ?? DateTime(2100))
                    .compareTo(bDate ?? DateTime(2100));
                if (dateCompare != 0) return dateCompare;
                final aOrder = (a.data()['mealOrder'] ?? 99) as int;
                final bOrder = (b.data()['mealOrder'] ?? 99) as int;
                return aOrder.compareTo(bOrder);
              });

            if (menus.isEmpty) {
              return const Center(child: Text('No published menus yet'));
            }

            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: menus.length,
              separatorBuilder: (_, __) => const SizedBox(height: 16),
              itemBuilder: (context, index) {
                final menuDoc = menus[index];
                final data = menuDoc.data();
                final ts = data['date'] as Timestamp?;
                final date = ts?.toDate();
                final meal = (data['meal'] ?? '').toString();
                final header = date == null
                    ? _mealLabel(meal)
                    : '${date.toLocal().toString().split(' ')[0]} | ${_mealLabel(meal)}';

                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                header,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.edit_calendar),
                              onPressed: () => _editMenu(context, menuDoc),
                            ),
                            IconButton(
                              icon: const Icon(Icons.delete_outline),
                              onPressed: () => service.deletePublishedMenu(menuDoc.id),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        _MenuItemsList(menuId: menuDoc.id),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }

  Future<void> _editMenu(
    BuildContext context,
    QueryDocumentSnapshot<Map<String, dynamic>> menuDoc,
  ) async {
    final service = PublishedMenuService();
    final data = menuDoc.data();
    final ts = data['date'] as Timestamp?;
    final initialDate = ts?.toDate() ?? DateTime.now();
    String meal = (data['meal'] ?? 'breakfast').toString();

    final date = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      initialDate: initialDate,
    );
    if (date == null) return;
    if (!context.mounted) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Edit Published Menu'),
          content: StatefulBuilder(
            builder: (context, setStateDialog) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Date: ${date.toLocal().toString().split(' ')[0]}'),
                  const SizedBox(height: 8),
                  RadioListTile<String>(
                    title: const Text('Breakfast'),
                    value: 'breakfast',
                    groupValue: meal,
                    onChanged: (value) => setStateDialog(() => meal = value!),
                  ),
                  RadioListTile<String>(
                    title: const Text('Lunch'),
                    value: 'lunch',
                    groupValue: meal,
                    onChanged: (value) => setStateDialog(() => meal = value!),
                  ),
                  RadioListTile<String>(
                    title: const Text('Snacks'),
                    value: 'snacks',
                    groupValue: meal,
                    onChanged: (value) => setStateDialog(() => meal = value!),
                  ),
                  RadioListTile<String>(
                    title: const Text('Dinner'),
                    value: 'dinner',
                    groupValue: meal,
                    onChanged: (value) => setStateDialog(() => meal = value!),
                  ),
                ],
              );
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;
    if (!context.mounted) return;

    await service.updatePublishedMenu(
      menuId: menuDoc.id,
      date: date,
      meal: meal,
    );
  }

  String _mealLabel(String meal) {
    switch (meal) {
      case 'breakfast':
        return 'Breakfast';
      case 'lunch':
        return 'Lunch';
      case 'snacks':
        return 'Snacks';
      case 'dinner':
        return 'Dinner';
      default:
        return meal;
    }
  }
}

class _MenuItemsList extends StatelessWidget {
  const _MenuItemsList({required this.menuId});

  final String menuId;

  @override
  Widget build(BuildContext context) {
    final menuService = PublishedMenuService();
    final orderService = OrderService();

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: menuService.watchMenuItems(menuId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final items = snapshot.data?.docs ?? [];
        if (items.isEmpty) {
          return const Text('No items');
        }

        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: orderService.watchOrdersByMenu(menuId),
          builder: (context, orderSnap) {
            final orders = orderSnap.data?.docs ?? [];

            return Column(
              children: items.map((doc) {
                final item = doc.data();
                final name = item['name'] ?? '';
                final price = item['price'] ?? 0;
                final qtyLeft = item['qty'] ?? 0;

                final stats = _calculateStats(orders, doc.id);

                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(name),
                  subtitle: Text(
                    'INR $price | Sold: ${stats.sold} | Orders: ${stats.orderCount} | Left: $qtyLeft',
                  ),
                  trailing: PopupMenuButton<String>(
                    onSelected: (value) {
                      if (value == 'edit') {
                        _editItem(context, menuId, doc.id, item);
                      }
                      if (value == 'delete') {
                        menuService.deletePublishedItem(menuId: menuId, itemId: doc.id);
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit')),
                      PopupMenuItem(value: 'delete', child: Text('Delete')),
                    ],
                  ),
                );
              }).toList(),
            );
          },
        );
      },
    );
  }

  _ItemStats _calculateStats(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> orders,
    String itemId,
  ) {
    var sold = 0;
    var orderCount = 0;

    for (final order in orders) {
      final items = (order.data()['items'] as List<dynamic>? ?? []);
      var found = false;
      for (final raw in items) {
        final map = raw as Map<String, dynamic>;
        final id = map['id'] as String?;
        if (id != null && id.endsWith(':$itemId')) {
          sold += (map['qty'] ?? 0) as int;
          found = true;
        }
      }
      if (found) orderCount += 1;
    }

    return _ItemStats(sold: sold, orderCount: orderCount);
  }

  Future<void> _editItem(
    BuildContext context,
    String menuId,
    String itemId,
    Map<String, dynamic> item,
  ) async {
    final qtyController = TextEditingController(text: '${item['qty'] ?? 0}');
    final priceController = TextEditingController(text: '${item['price'] ?? 0}');
    final service = PublishedMenuService();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Edit ${item['name'] ?? ''}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: qtyController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Quantity'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: priceController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Price (INR)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final qty = int.tryParse(qtyController.text.trim()) ?? 0;
    final price = int.tryParse(priceController.text.trim()) ?? 0;

    await service.updatePublishedItem(
      menuId: menuId,
      itemId: itemId,
      qty: qty,
      price: price,
    );
  }
}

class _ItemStats {
  const _ItemStats({required this.sold, required this.orderCount});

  final int sold;
  final int orderCount;
}
