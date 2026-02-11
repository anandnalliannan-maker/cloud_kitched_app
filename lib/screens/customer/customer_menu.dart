import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../models/cart_model.dart';
import '../../services/published_menu_service.dart';

class CustomerMenuScreen extends StatefulWidget {
  const CustomerMenuScreen({super.key, required this.cart});

  final CartModel cart;

  @override
  State<CustomerMenuScreen> createState() => _CustomerMenuScreenState();
}

class _CustomerMenuScreenState extends State<CustomerMenuScreen> {
  final _publishedService = PublishedMenuService();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _publishedService.watchPublishedMenus(),
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
                ? _mealLabel(meal).toUpperCase()
                : '${_formatDate(date)} - ${_mealLabel(meal).toUpperCase()}';

            return Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.teal.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        header,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                      stream: _publishedService.watchMenuItems(menuDoc.id),
                      builder: (context, itemSnap) {
                        if (itemSnap.connectionState == ConnectionState.waiting) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Center(child: CircularProgressIndicator()),
                          );
                        }

                        final items = itemSnap.data?.docs ?? [];
                        if (items.isEmpty) {
                          return const Text('No items');
                        }

                        return AnimatedBuilder(
                          animation: widget.cart,
                          builder: (context, _) => Column(
                            children: items.map((doc) {
                              final item = doc.data();
                              final name = item['name'] ?? '';
                              final price = item['price'] ?? 0;
                              final description = item['description'] ?? '';
                              final available = item['qty'] ?? 0;

                              final key = '${menuDoc.id}:${doc.id}';
                              final count = widget.cart.quantityFor(key);
                              final soldOut = available <= 0;
                              final canAdd = !soldOut && count < available;

                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(name),
                                subtitle: Text('INR $price\n$description'),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      onPressed: count > 0
                                          ? () => widget.cart.decrement(key)
                                          : null,
                                      icon: const Icon(Icons.remove_circle_outline),
                                    ),
                                    Text('$count'),
                                    IconButton(
                                      onPressed: canAdd
                                          ? () => widget.cart.addItem(
                                                id: key,
                                                name: name,
                                                price: price,
                                                maxQuantity: available,
                                              )
                                          : null,
                                      icon: const Icon(Icons.add_circle_outline),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
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

  String _formatDate(DateTime date) {
    final local = date.toLocal();
    final day = local.day;
    final month = _monthShort(local.month);
    final year = local.year;
    return '$day${_ordinal(day)} $month $year';
  }

  String _monthShort(int month) {
    const months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return months[month - 1];
  }

  String _ordinal(int day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  }
}
