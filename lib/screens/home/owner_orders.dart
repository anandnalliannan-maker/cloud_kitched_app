import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';
import '../../services/user_service.dart';

class OwnerOrdersScreen extends StatefulWidget {
  const OwnerOrdersScreen({super.key});

  @override
  State<OwnerOrdersScreen> createState() => _OwnerOrdersScreenState();
}

class _OwnerOrdersScreenState extends State<OwnerOrdersScreen> {
  final _orderService = OrderService();
  final _userService = UserService();
  final Set<String> _selectedOrderIds = {};

  void _toggleSelection(String id) {
    setState(() {
      if (_selectedOrderIds.contains(id)) {
        _selectedOrderIds.remove(id);
      } else {
        _selectedOrderIds.add(id);
      }
    });
  }

  Future<void> _openAssignSheet() async {
    if (_selectedOrderIds.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: _userService.watchActiveDeliveryUsers(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              );
            }

            final docs = snapshot.data?.docs ?? [];
            if (docs.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No active delivery users'),
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: docs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final doc = docs[index];
                final data = doc.data();
                final phone = data['phone'] ?? 'Unknown';

                return ListTile(
                  title: Text(phone),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await _orderService.assignOrders(
                      orderIds: _selectedOrderIds.toList(),
                      deliveryUserId: doc.id,
                      deliveryPhone: phone,
                    );
                    if (!mounted || !context.mounted) return;
                    Navigator.of(context).pop();
                    setState(() => _selectedOrderIds.clear());
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: TabBar(
              tabs: [
                Tab(text: 'Summary'),
                Tab(text: 'Active Orders'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _OwnerOrderSummary(orderService: _orderService),
                _OwnerActiveOrders(
                  orderService: _orderService,
                  selectedOrderIds: _selectedOrderIds,
                  onToggleSelection: _toggleSelection,
                  onAssign: _openAssignSheet,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OwnerOrderSummary extends StatelessWidget {
  const _OwnerOrderSummary({required this.orderService});

  final OrderService orderService;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: orderService.watchOrdersByStatuses(const ['new', 'assigned']),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(child: Text('Error loading summary: ${snapshot.error}'));
        }

        final orders = snapshot.data?.docs ?? [];
        final totalOrders = orders.length;
        final itemQty = <String, int>{};
        final areaCount = <String, int>{};

        for (final doc in orders) {
          final data = doc.data();
          final items = (data['items'] as List<dynamic>? ?? []);
          for (final raw in items) {
            final item = raw as Map<String, dynamic>;
            final name = (item['name'] ?? 'Item').toString();
            final qty = (item['qty'] ?? 0) as int;
            itemQty[name] = (itemQty[name] ?? 0) + qty;
          }

          final address = data['deliveryAddress'] as Map<String, dynamic>?;
          final area = (address?['area'] ?? 'Unknown').toString();
          areaCount[area] = (areaCount[area] ?? 0) + 1;
        }

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: ListTile(
                title: const Text('Active Orders'),
                trailing: Text(
                  '$totalOrders',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 22,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Menu Quantity Summary',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            if (itemQty.isEmpty)
              const Card(child: ListTile(title: Text('No active order items')))
            else
              ...itemQty.entries.map(
                (entry) => Card(
                  child: ListTile(
                    title: Text(entry.key),
                    trailing: Text(
                      '${entry.value}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            const Text(
              'Active Orders by Area',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            if (areaCount.isEmpty)
              const Card(child: ListTile(title: Text('No area data')))
            else
              ...areaCount.entries.map(
                (entry) => Card(
                  child: ListTile(
                    title: Text(entry.key),
                    trailing: Text(
                      '${entry.value}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _OwnerActiveOrders extends StatelessWidget {
  const _OwnerActiveOrders({
    required this.orderService,
    required this.selectedOrderIds,
    required this.onToggleSelection,
    required this.onAssign,
  });

  final OrderService orderService;
  final Set<String> selectedOrderIds;
  final ValueChanged<String> onToggleSelection;
  final VoidCallback onAssign;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: orderService.watchOrdersByStatuses(const ['new', 'assigned']),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(child: Text('Error loading orders: ${snapshot.error}'));
        }

        final docs = (snapshot.data?.docs ?? []).toList()
          ..sort((a, b) {
            final aTs = a.data()['createdAt'] as Timestamp?;
            final bTs = b.data()['createdAt'] as Timestamp?;
            final aDate = aTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            final bDate = bTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            return bDate.compareTo(aDate);
          });

        if (docs.isEmpty) {
          return const Center(child: Text('No active orders'));
        }

        return Column(
          children: [
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: docs.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final doc = docs[index];
                  final data = doc.data();
                  final status = (data['status'] ?? 'new').toString();
                  final isNew = status == 'new';
                  final orderId = (data['orderId'] ?? doc.id).toString();
                  final phone = (data['customerPhone'] ?? 'Unknown').toString();
                  final name = (data['customerName'] ?? 'Customer').toString();
                  final items = (data['items'] as List<dynamic>? ?? [])
                      .cast<Map<String, dynamic>>();
                  final itemDetails = items
                      .map((item) {
                        final itemName = (item['name'] ?? 'Item').toString();
                        final qty = item['qty'] ?? 0;
                        return '$itemName x$qty';
                      })
                      .join(', ');
                  final isSelected = selectedOrderIds.contains(doc.id);

                  return Card(
                    child: ListTile(
                      leading: isNew
                          ? Checkbox(
                              value: isSelected,
                              onChanged: (_) => onToggleSelection(doc.id),
                            )
                          : const Icon(Icons.assignment_turned_in_outlined),
                      title: Text('Order: $orderId'),
                      subtitle: Text(
                        'Status: ${status == 'assigned' ? 'Active' : 'New'}\n'
                        'Name: $name | Phone: $phone\n'
                        'Items: $itemDetails',
                      ),
                      isThreeLine: true,
                      onTap: isNew ? () => onToggleSelection(doc.id) : null,
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: selectedOrderIds.isNotEmpty ? onAssign : null,
                  icon: const Icon(Icons.assignment_ind),
                  label: Text('Assign (${selectedOrderIds.length})'),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

